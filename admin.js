const firebaseConfig = {
  apiKey: "AIzaSyAjp9_6nVxqUVneYVXd5m2hsD4ayJbwaLg",
  authDomain: "partial-insanity.firebaseapp.com",
  projectId: "partial-insanity",
  storageBucket: "partial-insanity.appspot.com",
  messagingSenderId: "746340494144",
  appId: "1:746340494144:web:86b5be3e2f5dfd2e92a8a5",
  measurementId: "G-3Q11XF589Q",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
let diagram = null;
let selectedNode = null;
let puzzleData = {};
let roomData = {};
let currentEditingPuzzle = null;
let currentEditingRoom = null;
let selectedTeam = null;
let teamDiagram = null;
const SECURITY_SALT = "partial-insanity-2025-salt";
const ADMIN_COLLECTION = "adminCredentials";
let lastDataHash = null;
let autoRefreshInterval = null;
let isUserEditing = false;

async function adminLogin() {
  const password = document.getElementById("admin-password").value;

  try {
    const adminDoc = await db
      .collection(ADMIN_COLLECTION)
      .doc("credentials")
      .get();

    if (!adminDoc.exists) {
      showAdminError("Admin credentials not set up");
      return;
    }

    const adminData = adminDoc.data();
    const inputHash = CryptoJS.SHA256(password + SECURITY_SALT).toString();

    if (inputHash === adminData.passwordHash) {
      document.getElementById("admin-login").classList.add("hidden");
      document.getElementById("admin-panel").classList.remove("hidden");
      initializeDiagram();
      loadTeamProgress();
      if (
        !document.getElementById("admin-panel").classList.contains("hidden")
      ) {
        lastDataHash = generateDataHash(puzzleData, roomData);
        startAutoRefresh();
      }
    } else {
      showAdminError("Invalid password");
    }
  } catch (error) {
    console.error("Error during login:", error);
    showAdminError("Error during login");
  }
}

function adminLogout() {
  document.getElementById("admin-panel").classList.add("hidden");
  document.getElementById("admin-login").classList.remove("hidden");
  document.getElementById("admin-password").value = "";
  stopAutoRefresh();
}

function showAdminError(message) {
  const errorDiv = document.getElementById("admin-error");
  errorDiv.textContent = message;
  errorDiv.classList.remove("hidden");
  setTimeout(() => errorDiv.classList.add("hidden"), 3000);
}

function showAdminSection(section) {
  document
    .querySelectorAll(".admin-section")
    .forEach((el) => el.classList.add("hidden"));
  document.getElementById(`admin-${section}`).classList.remove("hidden");
  if (section === "mindmap") {
    setTimeout(() => diagram && diagram.requestUpdate(), 100);
  }
}

function initializeDiagram() {
  const $ = go.GraphObject.make;
  diagram = $(go.Diagram, "mindmapDiagram", {
    "undoManager.isEnabled": true,
    layout: $(go.ForceDirectedLayout, {
      maxIterations: 300,
      defaultSpringLength: 80,
      defaultElectricalCharge: 100,
      defaultGravitationalMass: 0.5,
    }),
    "toolManager.hoverDelay": 500,

    allowZoom: true,
    allowHorizontalScroll: true,
    allowVerticalScroll: true,
    initialContentAlignment: go.Spot.Center,

    "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
    minScale: 0.3,
    maxScale: 3.0,
    initialScale: 0.8,
  });

  diagram.groupTemplate = $(
    go.Group,
    "Vertical",
    {
      selectionChanged: function (group) {},
      ungroupable: true,
      layout: $(go.GridLayout, {
        wrappingColumn: 3,
        spacing: new go.Size(5, 5),
      }),
      click: function (e, group) {
        editRoom(group.data.key);
      },
    },
    $(
      go.TextBlock,
      {
        font: "bold 10pt sans-serif",
        editable: true,
        margin: new go.Margin(2, 4),
      },
      new go.Binding("text", "name")
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        fill: "transparent",
        stroke: "#D2691E",
        strokeWidth: 2,
      }),
      $(go.Placeholder, { padding: 8 })
    )
  );

  diagram.nodeTemplate = $(
    go.Node,
    "Auto",
    {
      selectionAdorned: true,
      click: function (e, node) {
        editPuzzle(node.data.key);
      },
    },
    $(
      go.Shape,
      "Rectangle",
      {
        minSize: new go.Size(60, 40),
        maxSize: new go.Size(150, 60),
        strokeWidth: 1.5,
        stroke: "#333",
      },
      new go.Binding("fill", "type", function (type) {
        switch (type) {
          case "meta":
            return "#D8BFD8";
          case "lock":
            return "#FFA07A";
          default:
            return "#ADD8E6";
        }
      }),

      new go.Binding("width", "name", function (name) {
        const baseWidth = 60;
        const charWidth = 6;
        const calculatedWidth = Math.max(
          baseWidth,
          Math.min(150, name.length * charWidth + 20)
        );
        return calculatedWidth;
      })
    ),
    $(
      go.TextBlock,
      {
        margin: new go.Margin(4, 6),
        font: "9px sans-serif",
        wrap: go.TextBlock.WrapFit,
        textAlign: "center",
        overflow: go.TextBlock.OverflowEllipsis,
      },
      new go.Binding("text", "name")
    )
  );

  diagram.linkTemplate = $(
    go.Link,
    {
      routing: go.Link.AvoidsNodes,
      curve: go.Link.JumpOver,
      corner: 8,
    },
    $(go.Shape, { stroke: "#333", strokeWidth: 1.5 }),
    $(go.Shape, {
      toArrow: "Standard",
      fill: "#333",
      stroke: null,
      scale: 0.8,
    })
  );

  diagram.linkTemplateMap.add(
    "roomUnlock",
    $(
      go.Link,
      {
        routing: go.Link.AvoidsNodes,
        curve: go.Link.JumpOver,
        layerName: "Background",
        corner: 8,
      },
      $(go.Shape, {
        stroke: "#FF6B35",
        strokeWidth: 2,
        strokeDashArray: [6, 3],
      }),
      $(go.Shape, {
        toArrow: "Standard",
        fill: "#FF6B35",
        stroke: null,
        scale: 1.2,
      })
    )
  );

  addZoomControls("mindmapDiagram", diagram);

  loadDiagramData();
}

async function loadDiagramData() {
  try {
    const [puzzlesDoc, roomsDoc] = await Promise.all([
      db.collection("puzzles").doc("config").get(),
      db.collection("rooms").doc("config").get(),
    ]);

    puzzleData = puzzlesDoc.exists ? puzzlesDoc.data() : {};
    roomData = roomsDoc.exists ? roomsDoc.data() : {};

    const nodes = [];
    const links = [];
    const groups = [];

    Object.entries(roomData).forEach(([roomId, room]) => {
      groups.push({
        key: roomId,
        isGroup: true,
        name: room.name || roomId,
        category: "room",
      });
    });

    Object.entries(puzzleData).forEach(([puzzleId, puzzle]) => {
      const nodeData = {
        key: puzzleId,
        name: puzzle.name || puzzleId,
        type: puzzle.type || "puzzle",
      };

      if (puzzle.room && roomData[puzzle.room]) {
        nodeData.group = puzzle.room;
      }

      nodes.push(nodeData);

      if (puzzle.unlocks) {
        links.push({ from: puzzleId, to: puzzle.unlocks });
      }

      if (puzzle.followup) {
        links.push({ from: puzzleId, to: puzzle.followup });
      }
    });

    Object.entries(roomData).forEach(([roomId, room]) => {
      if (room.clearUnlock) {
        const targetId = room.clearUnlock.id;
        if (room.clearUnlock.type === "room" && roomData[targetId]) {
          links.push({
            from: roomId,
            to: targetId,
            category: "roomUnlock",
          });
        } else if (room.clearUnlock.type === "puzzle" && puzzleData[targetId]) {
          links.push({
            from: roomId,
            to: targetId,
            category: "roomUnlock",
          });
        }
      }
    });

    diagram.model = new go.GraphLinksModel({
      nodeCategoryProperty: "category",
      linkCategoryProperty: "category",
      nodeDataArray: [...groups, ...nodes],
      linkDataArray: links,
    });

    diagram.commit(function (diag) {
      diag.nodes.each(function (node) {
        if (node.isGroup) node.visible = true;
      });
    });

    setTimeout(() => {
      if (diagram) {
        diagram.zoomToFit();
      }
    }, 500);
  } catch (error) {
    console.error("Error loading diagram data:", error);
  }
}

function addHint() {
  const container = document.getElementById("hintsContainer");
  const div = document.createElement("div");
  div.className = "hint-entry";
  div.innerHTML = `
        <textarea class="hint-problem" placeholder="Problem description"></textarea>
        <textarea class="hint-text" placeholder="Hint solution"></textarea>
        <button class="btn btn-sm btn-danger" onclick="removeHint(this)">×</button>
    `;
  container.appendChild(div);
}

function removeHint(btn) {
  btn.closest(".hint-entry").remove();
}

async function loadTeamProgress() {
  try {
    const snapshot = await db.collection("progress").get();
    const teamList = document.getElementById("teamList");
    teamList.innerHTML = "";

    if (snapshot.empty) {
      teamList.innerHTML = "<p>No teams found.</p>";
      return;
    }

    const teams = [];
    for (const doc of snapshot.docs) {
      const progress = doc.data();
      const teamDoc = await db.collection("teams").doc(doc.id).get();
      const teamData = teamDoc.exists
        ? teamDoc.data()
        : { name: "Unknown Team" };

      teams.push({
        id: doc.id,
        name: teamData.name,
        email: teamData.email,
        progress: progress,
      });
    }

    teams.forEach((team) => {
      const div = document.createElement("div");
      div.className = "team-card";
      div.innerHTML = `
                        <h4>${team.name}</h4>
                        <p>Email: ${team.email || "N/A"}</p>
                        <p>Solved: ${
                          (team.progress.solvedPuzzles || []).length
                        } puzzles</p>
                        <p>Rooms unlocked: ${
                          (team.progress.unlockedRooms || []).length
                        }</p>
                        <p>Rooms cleared: ${
                          (team.progress.clearedRooms || []).length
                        }</p>
                    `;
      div.onclick = () => showTeamDetails(team);
      teamList.appendChild(div);
    });
  } catch (error) {
    console.error("Error loading team progress:", error);
  }
}

function showTeamDetails(team) {
  selectedTeam = team;
  document.querySelectorAll(".team-card").forEach((card) => {
    card.classList.remove("selected");
  });

  event.target.closest(".team-card").classList.add("selected");

  const content = document.getElementById("teamProgressContent");
  const progress = team.progress;

  const allPuzzles = Object.keys(puzzleData);
  const solvedPuzzles = progress.solvedPuzzles || [];

  if (progress.hintUsage && progress.hintUsage[puzzleId]) {
    const hintCount = progress.hintUsage[puzzleId].length;
    puzzleHtml += `<p>Hints used: ${
      progress.hintUsage?.[puzzleId]?.length || 0
    }</p>`;
  }

  let puzzleGrid = `<div class="puzzle-grid">
        ${allPuzzles
          .map((puzzleId) => {
            const isSolved = solvedPuzzles.includes(puzzleId);
            const puzzle = puzzleData[puzzleId];
            return `
                <div class="puzzle-preview ${isSolved ? "solved" : "unsolved"}">
                    <h5>${puzzle.name || puzzleId}</h5>
                    <p>Type: ${puzzle.type || "puzzle"}</p>
                    <p>Status: ${isSolved ? "✅ Solved" : "❌ Unsolved"}</p>
                    ${
                      progress.guessCount?.[puzzleId]
                        ? `<p>Guesses used: ${progress.guessCount[puzzleId]}</p>`
                        : ""
                    }
                    <p>Hints used: ${
                      progress.hintUsage?.[puzzleId]?.length || 0
                    }</p>
                </div>
            `;
          })
          .join("")}
    </div>`;
  allPuzzles.forEach((puzzleId) => {
    const puzzle = puzzleData[puzzleId];
    const isSolved = solvedPuzzles.includes(puzzleId);
    puzzleGrid += `
                    <div class="puzzle-preview ${
                      isSolved ? "solved" : "unsolved"
                    }">
                        <h5>${puzzle.name || puzzleId}</h5>
                        <p>Type: ${puzzle.type || "puzzle"}</p>
                        <p>Status: ${isSolved ? "✅ Solved" : "❌ Unsolved"}</p>
                        ${
                          progress.guessCount && progress.guessCount[puzzleId]
                            ? `<p>Guesses used: ${progress.guessCount[puzzleId]}</p>`
                            : ""
                        }
                    </div>
                `;
  });
  puzzleGrid += "</div>";

  content.innerHTML = `
                <div class="progress-stats">
                    <div class="stat-card">
                        <h4>${solvedPuzzles.length}</h4>
                        <p>Puzzles Solved</p>
                    </div>
                    <div class="stat-card">
                        <h4>${(progress.unlockedRooms || []).length}</h4>
                        <p>Rooms Unlocked</p>
                    </div>
                    <div class="stat-card">
                        <h4>${(progress.clearedRooms || []).length}</h4>
                        <p>Rooms Cleared</p>
                    </div>
                </div>

                <h4>${team.name} - Detailed Progress</h4>
                <p><strong>Email:</strong> ${team.email || "N/A"}</p>
                <p><strong>Current Room:</strong> ${
                  progress.currentRoom || "starting-room"
                }</p>

                <h5>Unlocked Rooms:</h5>
                <ul>${(progress.unlockedRooms || ["starting-room"])
                  .map(
                    (r) =>
                      `<li>${roomData[r]?.name || r} ${
                        (progress.clearedRooms || []).includes(r)
                          ? "(Cleared)"
                          : ""
                      }</li>`
                  )
                  .join("")}</ul>

                <h5>Puzzle Status:</h5>
                ${puzzleGrid}
            `;

  document.getElementById("teamDetails").classList.remove("hidden");
}

function showTeamMindMap() {
  if (!selectedTeam) {
    alert("Please select a team first.");
    return;
  }
  const modal = document.getElementById("teamMindmapModal");
  modal.style.display = "block";
  document.getElementById("teamMindmapName").textContent = selectedTeam.name;
  initializeTeamMindmap();
}

function closeTeamMindmap() {
  document.getElementById("teamMindmapModal").style.display = "none";
  if (teamDiagram) {
    teamDiagram.div = null;
    teamDiagram = null;
  }
}

function initializeTeamMindmap() {
  const $ = go.GraphObject.make;
  if (teamDiagram) teamDiagram.div = null;

  teamDiagram = $(go.Diagram, "teamMindmapDiagram", {
    "undoManager.isEnabled": false,
    layout: $(go.ForceDirectedLayout, {
      maxIterations: 300,
      defaultSpringLength: 80,
      defaultElectricalCharge: 100,
      defaultGravitationalMass: 0.5,
    }),

    allowZoom: true,
    allowHorizontalScroll: true,
    allowVerticalScroll: true,
    initialContentAlignment: go.Spot.Center,
    "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
    minScale: 0.3,
    maxScale: 3.0,
    initialScale: 0.8,
  });

  teamDiagram.groupTemplate = $(
    go.Group,
    "Vertical",
    {
      click: function (e, group) {
        const roomId = group.data.key;
        const isUnlocked = (selectedTeam.progress.unlockedRooms || []).includes(
          roomId
        );
        const isCleared = (selectedTeam.progress.clearedRooms || []).includes(
          roomId
        );

        if (
          confirm(
            `${
              isCleared
                ? "Room is cleared. Lock it?"
                : isUnlocked
                ? "Lock this room?"
                : "Unlock this room?"
            }`
          )
        ) {
          toggleRoomStatus(roomId, !isUnlocked, isCleared);
        }
      },
    },
    $(
      go.TextBlock,
      {
        font: "bold 10pt sans-serif",
        margin: new go.Margin(2, 4),
      },
      new go.Binding("text", "name")
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        stroke: "#D2691E",
        strokeWidth: 2,
      }).bind("fill", "", function (data) {
        if ((selectedTeam.progress.clearedRooms || []).includes(data.key))
          return "#90EE90";
        if ((selectedTeam.progress.unlockedRooms || []).includes(data.key))
          return "#FFFF99";
        return "#FF9999";
      }),
      $(go.Placeholder, { padding: 8 })
    )
  );

  teamDiagram.nodeTemplate = $(
    go.Node,
    "Auto",
    {
      click: function (e, node) {
        const puzzleId = node.data.key;
        const isDone = (selectedTeam.progress.solvedPuzzles || []).includes(
          puzzleId
        );
        if (confirm(`Mark puzzle as ${isDone ? "not done" : "done"}?`)) {
          togglePuzzleStatus(puzzleId, !isDone);
        }
      },
    },
    $(go.Shape, "Rectangle", {
      minSize: new go.Size(60, 40),
      maxSize: new go.Size(150, 60),
      strokeWidth: 1.5,
      stroke: "#333",
    })
      .bind("fill", "", function (data) {
        if ((selectedTeam.progress.solvedPuzzles || []).includes(data.key))
          return "#90EE90";

        if (isPuzzleUnlockedForTeam(data.key)) return "#FFFF99";

        return "#FF9999";
      })
      .bind("width", "name", function (name) {
        const baseWidth = 60;
        const charWidth = 6;
        return Math.max(baseWidth, Math.min(150, name.length * charWidth + 20));
      }),
    $(
      go.TextBlock,
      {
        margin: new go.Margin(4, 6),
        font: "9px sans-serif",
        wrap: go.TextBlock.WrapFit,
        textAlign: "center",
        overflow: go.TextBlock.OverflowEllipsis,
      },
      new go.Binding("text", "name")
    )
  );

  teamDiagram.linkTemplate = $(
    go.Link,
    {
      routing: go.Link.AvoidsNodes,
      curve: go.Link.JumpOver,
      corner: 8,
    },
    $(go.Shape, { stroke: "#333", strokeWidth: 1.5 }),
    $(go.Shape, {
      toArrow: "Standard",
      fill: "#333",
      stroke: null,
      scale: 0.8,
    })
  );

  teamDiagram.linkTemplateMap.add(
    "roomUnlock",
    $(
      go.Link,
      {
        routing: go.Link.AvoidsNodes,
        curve: go.Link.JumpOver,
        layerName: "Background",
        corner: 8,
      },
      $(go.Shape, {
        stroke: "#FF6B35",
        strokeWidth: 2,
        strokeDashArray: [6, 3],
      }),
      $(go.Shape, {
        toArrow: "Standard",
        fill: "#FF6B35",
        stroke: null,
        scale: 1.2,
      })
    )
  );

  const nodes = [];
  const groups = [];
  const links = [];

  Object.entries(roomData).forEach(([id, room]) => {
    groups.push({
      key: id,
      isGroup: true,
      name: room.name || id,
      category: "room",
    });
  });

  Object.entries(puzzleData).forEach(([id, puzzle]) => {
    const nodeData = {
      key: id,
      name: puzzle.name || id,
      category: "puzzle",
    };

    if (puzzle.room && roomData[puzzle.room]) {
      nodeData.group = puzzle.room;
    }

    nodes.push(nodeData);

    if (puzzle.unlocks) links.push({ from: id, to: puzzle.unlocks });
    if (puzzle.followup) links.push({ from: id, to: puzzle.followup });
  });

  Object.entries(roomData).forEach(([roomId, room]) => {
    if (room.clearUnlock) {
      const targetId = room.clearUnlock.id;
      if (room.clearUnlock.type === "room" && roomData[targetId]) {
        links.push({
          from: roomId,
          to: targetId,
          category: "roomUnlock",
        });
      } else if (room.clearUnlock.type === "puzzle" && puzzleData[targetId]) {
        links.push({
          from: roomId,
          to: targetId,
          category: "roomUnlock",
        });
      }
    }
  });

  teamDiagram.model = new go.GraphLinksModel({
    nodeDataArray: [...groups, ...nodes],
    linkDataArray: links,
    nodeCategoryProperty: "category",
    linkCategoryProperty: "category",
  });

  addZoomControls("teamMindmapDiagram", teamDiagram);

  teamDiagram.layoutDiagram(true);
}

function initializeDiagram() {
  const $ = go.GraphObject.make;
  diagram = $(go.Diagram, "mindmapDiagram", {
    "undoManager.isEnabled": true,
    layout: $(go.ForceDirectedLayout, {
      maxIterations: 300,
      defaultSpringLength: 80,
      defaultElectricalCharge: 100,
      defaultGravitationalMass: 0.5,
    }),
    "toolManager.hoverDelay": 500,

    allowZoom: true,
    allowHorizontalScroll: true,
    allowVerticalScroll: true,
    initialContentAlignment: go.Spot.Center,

    "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
    minScale: 0.3,
    maxScale: 3.0,
    initialScale: 0.8,
  });

  diagram.groupTemplate = $(
    go.Group,
    "Vertical",
    {
      selectionChanged: function (group) {},
      ungroupable: true,
      layout: $(go.GridLayout, {
        wrappingColumn: 3,
        spacing: new go.Size(5, 5),
      }),
      click: function (e, group) {
        editRoom(group.data.key);
      },
    },
    $(
      go.TextBlock,
      {
        font: "bold 10pt sans-serif",
        editable: true,
        margin: new go.Margin(2, 4),
      },
      new go.Binding("text", "name")
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        fill: "transparent",
        stroke: "#D2691E",
        strokeWidth: 2,
      }),
      $(go.Placeholder, { padding: 8 })
    )
  );

  diagram.nodeTemplate = $(
    go.Node,
    "Auto",
    {
      selectionAdorned: true,
      click: function (e, node) {
        editPuzzle(node.data.key);
      },
    },
    $(
      go.Shape,
      "Rectangle",
      {
        minSize: new go.Size(60, 40),
        maxSize: new go.Size(150, 60),
        strokeWidth: 1.5,
        stroke: "#333",
      },
      new go.Binding("fill", "type", function (type) {
        switch (type) {
          case "meta":
            return "#D8BFD8";
          case "lock":
            return "#FFA07A";
          default:
            return "#ADD8E6";
        }
      }),

      new go.Binding("width", "name", function (name) {
        const baseWidth = 60;
        const charWidth = 6;
        const calculatedWidth = Math.max(
          baseWidth,
          Math.min(150, name.length * charWidth + 20)
        );
        return calculatedWidth;
      })
    ),
    $(
      go.TextBlock,
      {
        margin: new go.Margin(4, 6),
        font: "9px sans-serif",
        wrap: go.TextBlock.WrapFit,
        textAlign: "center",
        overflow: go.TextBlock.OverflowEllipsis,
      },
      new go.Binding("text", "name")
    )
  );

  diagram.linkTemplate = $(
    go.Link,
    {
      routing: go.Link.AvoidsNodes,
      curve: go.Link.JumpOver,
      corner: 8,
    },
    $(go.Shape, { stroke: "#333", strokeWidth: 1.5 }),
    $(go.Shape, {
      toArrow: "Standard",
      fill: "#333",
      stroke: null,
      scale: 0.8,
    })
  );

  diagram.linkTemplateMap.add(
    "roomUnlock",
    $(
      go.Link,
      {
        routing: go.Link.AvoidsNodes,
        curve: go.Link.JumpOver,
        layerName: "Background",
        corner: 8,
      },
      $(go.Shape, {
        stroke: "#FF6B35",
        strokeWidth: 2,
        strokeDashArray: [6, 3],
      }),
      $(go.Shape, {
        toArrow: "Standard",
        fill: "#FF6B35",
        stroke: null,
        scale: 1.2,
      })
    )
  );

  addZoomControls("mindmapDiagram", diagram);

  loadDiagramData();
}

function addZoomControls(containerId, diagramInstance) {
  const container = document.getElementById(containerId);

  const existingControls = container.querySelector(".zoom-controls");
  if (existingControls) {
    existingControls.remove();
  }

  const zoomControls = document.createElement("div");
  zoomControls.className = "zoom-controls";
  zoomControls.innerHTML = `
    <button class="zoom-btn" onclick="zoomIn('${containerId}')" title="Zoom In">+</button>
    <button class="zoom-btn" onclick="zoomOut('${containerId}')" title="Zoom Out">−</button>
    <button class="zoom-btn" onclick="zoomToFit('${containerId}')" title="Fit to Screen">⌂</button>
    <button class="zoom-btn" onclick="resetZoom('${containerId}')" title="Reset Zoom">1:1</button>
  `;

  container.appendChild(zoomControls);
}

function zoomIn(containerId) {
  const diagramInstance =
    containerId === "mindmapDiagram" ? diagram : teamDiagram;
  if (diagramInstance) {
    diagramInstance.commandHandler.increaseZoom();
  }
}

function zoomOut(containerId) {
  const diagramInstance =
    containerId === "mindmapDiagram" ? diagram : teamDiagram;
  if (diagramInstance) {
    diagramInstance.commandHandler.decreaseZoom();
  }
}

function zoomToFit(containerId) {
  const diagramInstance =
    containerId === "mindmapDiagram" ? diagram : teamDiagram;
  if (diagramInstance) {
    diagramInstance.commandHandler.zoomToFit();
  }
}

function resetZoom(containerId) {
  const diagramInstance =
    containerId === "mindmapDiagram" ? diagram : teamDiagram;
  if (diagramInstance) {
    diagramInstance.scale = 1.0;
  }
}

function isPuzzleUnlockedForTeam(puzzleId) {
  const puzzle = puzzleData[puzzleId];

  if (!puzzle.room || !roomData[puzzle.room]) return true;

  const roomId = puzzle.room;
  if (
    (selectedTeam.progress.unlockedRooms || []).includes(roomId) ||
    (selectedTeam.progress.clearedRooms || []).includes(roomId)
  ) {
    return true;
  }

  return Object.values(puzzleData).some(
    (p) =>
      p.followup === puzzleId &&
      (selectedTeam.progress.solvedPuzzles || []).includes(p.key)
  );
}
async function toggleRoomStatus(roomId, unlock, wasCleared) {
  const teamRef = db.collection("progress").doc(selectedTeam.id);
  const updates = {};

  if (unlock) {
    updates[`unlockedRooms`] = firebase.firestore.FieldValue.arrayUnion(roomId);
    if (wasCleared) {
      updates[`clearedRooms`] =
        firebase.firestore.FieldValue.arrayRemove(roomId);
    }
  } else {
    updates[`unlockedRooms`] =
      firebase.firestore.FieldValue.arrayRemove(roomId);
    updates[`clearedRooms`] = firebase.firestore.FieldValue.arrayRemove(roomId);
  }

  try {
    await teamRef.update(updates);

    if (unlock) {
      selectedTeam.progress.unlockedRooms = [
        ...(selectedTeam.progress.unlockedRooms || []),
        roomId,
      ];
      if (wasCleared) {
        selectedTeam.progress.clearedRooms = (
          selectedTeam.progress.clearedRooms || []
        ).filter((id) => id !== roomId);
      }
    } else {
      selectedTeam.progress.unlockedRooms = (
        selectedTeam.progress.unlockedRooms || []
      ).filter((id) => id !== roomId);
      selectedTeam.progress.clearedRooms = (
        selectedTeam.progress.clearedRooms || []
      ).filter((id) => id !== roomId);
    }

    if (teamDiagram) {
      teamDiagram.startTransaction("update room status");
      teamDiagram.updateAllTargetBindings();
      teamDiagram.commitTransaction("update room status");
    }
  } catch (error) {
    console.error("Error updating room status:", error);
    alert("Error updating room status");
  }
}

async function togglePuzzleStatus(puzzleId, done) {
  const teamRef = db.collection("progress").doc(selectedTeam.id);
  try {
    if (done) {
      await teamRef.update({
        solvedPuzzles: firebase.firestore.FieldValue.arrayUnion(puzzleId),
      });
      selectedTeam.progress.solvedPuzzles = [
        ...(selectedTeam.progress.solvedPuzzles || []),
        puzzleId,
      ];
    } else {
      await teamRef.update({
        solvedPuzzles: firebase.firestore.FieldValue.arrayRemove(puzzleId),
      });
      selectedTeam.progress.solvedPuzzles = (
        selectedTeam.progress.solvedPuzzles || []
      ).filter((id) => id !== puzzleId);
    }

    if (teamDiagram) {
      teamDiagram.startTransaction("update puzzle status");
      teamDiagram.updateAllTargetBindings();
      teamDiagram.commitTransaction("update puzzle status");
    }
  } catch (error) {
    console.error("Error updating puzzle status:", error);
    alert("Error updating puzzle status");
  }
}

function showPuzzleEditor(puzzleId = null) {
  isUserEditing = true;
  currentEditingPuzzle = puzzleId;
  const modal = document.getElementById("puzzleEditor");
  const title = document.getElementById("puzzleEditorTitle");
  const deleteBtn = document.getElementById("deletePuzzleBtn");

  const roomSelect = document.getElementById("puzzleRoom");
  roomSelect.innerHTML = '<option value="">-- Select Room --</option>';
  Object.keys(roomData).forEach((roomId) => {
    roomSelect.innerHTML += `<option value="${roomId}">${
      roomData[roomId].name || roomId
    }</option>`;
  });

  const followupSelect = document.getElementById("puzzleFollowup");
  followupSelect.innerHTML =
    '<option value="">-- Select Follow-up Puzzle --</option>';
  Object.keys(puzzleData).forEach((pId) => {
    if (pId !== puzzleId) {
      followupSelect.innerHTML += `<option value="${pId}">${
        puzzleData[pId].name || pId
      }</option>`;
    }
  });

  const unlocksSelect = document.getElementById("puzzleUnlocks");
  unlocksSelect.innerHTML = '<option value="">-- Select Unlocks --</option>';

  unlocksSelect.innerHTML += '<optgroup label="Rooms">';
  Object.keys(roomData).forEach((roomId) => {
    unlocksSelect.innerHTML += `<option value="${roomId}">Room: ${
      roomData[roomId].name || roomId
    }</option>`;
  });

  unlocksSelect.innerHTML += '<optgroup label="Puzzles">';
  Object.keys(puzzleData).forEach((pId) => {
    if (pId !== puzzleId) {
      unlocksSelect.innerHTML += `<option value="${pId}">Puzzle: ${
        puzzleData[pId].name || pId
      }</option>`;
    }
  });

  if (puzzleId && puzzleData[puzzleId]) {
    title.textContent = "Edit Puzzle";
    deleteBtn.style.display = "inline-block";
    fillPuzzleEditor(puzzleData[puzzleId]);

    if (puzzleData[puzzleId].room) {
      roomSelect.value = puzzleData[puzzleId].room;
    }
    if (puzzleData[puzzleId].followup) {
      followupSelect.value = puzzleData[puzzleId].followup;
    }
    if (puzzleData[puzzleId].unlocks) {
      unlocksSelect.value = puzzleData[puzzleId].unlocks;
    }
  } else {
    title.textContent = "Add New Puzzle";
    deleteBtn.style.display = "none";
    clearPuzzleEditor();
  }

  modal.style.display = "block";
  updatePuzzleTypeFields();
}

function fillPuzzleEditor(puzzle) {
  document.getElementById("puzzleName").value = puzzle.name || "";
  document.getElementById("puzzleType").value = puzzle.type || "puzzle";
  document.getElementById("puzzleHasAnswer").checked = puzzle.answers && puzzle.answers.length > 0;
  document.getElementById("puzzleAnswers").value = puzzle.answers 
    ? puzzle.answers.map(a => decryptAnswer(a)).join(", ")
    : "";
  const bindingsContainer = document.getElementById("answerBindingsContainer");
  bindingsContainer.innerHTML = "";
  if (puzzle.answerBindings) {
    puzzle.answerBindings.forEach(binding => {
      addAnswerBinding(
        binding.isSolveBinding ? '' : (binding.answer ? decryptAnswer(binding.answer) : ''),
        binding.targetPuzzle,
        binding.isSolveBinding
      );
    });
  }
    const eventsContainer = document.getElementById("puzzleEventsContainer");
  eventsContainer.innerHTML = "";
  if (puzzle.events) {
    puzzle.events.forEach(event => {
      addPuzzleEvent(
        event.trigger,
        event.action,
        event.action === 'notify' 
          ? event.actionValue 
          : event.actionValue,
        event.trigger === 'answer' ? decryptAnswer(event.triggerValue) : ''
      );
    });
  }
  document.getElementById("puzzleMaxGuesses").value = puzzle.maxGuesses || 10;
  document.getElementById("puzzleRequiredCorrect").value =
    puzzle.requiredCorrect || 1;
  document.getElementById("puzzleDescription").value = puzzle.description || "";
  document.getElementById("mediaList").innerHTML = "";
  toggleAnswerFields();
  if (puzzle.media) {
    puzzle.media.forEach((media) => {
      const mediaList = document.getElementById("mediaList");
      const mediaId = `media_${Date.now()}`;

      const mediaItem = document.createElement("div");
      mediaItem.className = "media-item";
      mediaItem.id = mediaId;
      mediaItem.dataset.type = media.type;
      mediaItem.dataset.url = media.url;

      let previewContent = "";
      if (media.type === "pdf") {
        previewContent = `<i class="fas fa-file-pdf" style="font-size: 40px; color: #e74c3c; display: block; text-align: center;"></i>`;
      } else if (media.type === "sheet") {
        previewContent = `<i class="fas fa-table" style="font-size: 40px; color: #2ecc71; display: block; text-align: center;"></i>`;
      } else {
        previewContent = `<img src="${media.url}" onerror="this.parentNode.remove()" style="max-width: 100px; max-height: 80px;">`;
      }

      mediaItem.innerHTML = `
        ${previewContent}
        <div class="media-type">${media.type.toUpperCase()}</div>
        <div class="media-actions">
          <button onclick="moveMediaUp('${mediaId}')">↑</button>
          <button onclick="moveMediaDown('${mediaId}')">↓</button>
          <button onclick="removeMedia('${mediaId}')">×</button>
        </div>
      `;

      mediaList.appendChild(mediaItem);
    });
  }

  checkPdfRequirement();
  document.getElementById("puzzleFollowup").value = puzzle.followup || "";
  document.getElementById("puzzleUnlocks").value = puzzle.unlocks || "";
  document.getElementById("puzzleSolveMessage").value =
    puzzle.solveMessage || "";
  document.getElementById("puzzlePositionX").value = puzzle.position?.x || 100;
  document.getElementById("puzzlePositionY").value = puzzle.position?.y || 100;
  document.getElementById("puzzleRotation").value =
    puzzle.position?.rotation || 0;
  const hintsContainer = document.getElementById("hintsContainer");
  hintsContainer.innerHTML = "";
  if (puzzle.hints) {
    puzzle.hints.forEach((hint) => {
      const div = document.createElement("div");
      div.className = "hint-entry";
      div.innerHTML = `
            <textarea class="hint-problem">${hint.problem || ""}</textarea>
            <textarea class="hint-text">${hint.text || ""}</textarea>
            <button class="btn btn-sm btn-danger" onclick="removeHint(this)">×</button>
        `;
      hintsContainer.appendChild(div);
    });
  }
}

function clearPuzzleEditor() {
  document.getElementById("puzzleName").value = "";
  document.getElementById("puzzleType").value = "puzzle";
  document.getElementById("puzzleHasAnswer").checked = true;
  document.getElementById("puzzleAnswers").value = "";
  document.getElementById("puzzleMaxGuesses").value = 10;
  document.getElementById("puzzleRequiredCorrect").value = 1;
  document.getElementById("puzzleDescription").value = "";
  document.getElementById("mediaList").value = "";
  document.getElementById("puzzleFollowup").value = "";
  document.getElementById("puzzleUnlocks").value = "";
  document.getElementById("puzzleSolveMessage").value = "";
  document.getElementById("puzzlePositionX").value = 100;
  document.getElementById("puzzlePositionY").value = 100;
  document.getElementById("puzzleRotation").value = 0;
}

function updatePuzzleTypeFields() {
  const type = document.getElementById("puzzleType").value;
  const lockDesc = document.getElementById("lockDescriptionField");
  const requiredField = document.getElementById("requiredCorrectField");

  if (type === "lock") {
    lockDesc.classList.remove("hidden");
    requiredField.classList.remove("hidden");
  } else {
    lockDesc.classList.add("hidden");
    requiredField.classList.add("hidden");
  }
}

function toggleAnswerFields() {
  const hasAnswer = document.getElementById("puzzleHasAnswer").checked;
  const answerFields = document.getElementById("answerFields");
  if (hasAnswer) {
    answerFields.classList.remove("hidden");
  } else {
    answerFields.classList.add("hidden");
  }
}

function closePuzzleEditor() {
  isUserEditing = false;
  document.getElementById("puzzleEditor").style.display = "none";
  currentEditingPuzzle = null;
}

function editPuzzle(puzzleId) {
  if (!puzzleData[puzzleId]) {
    alert("Puzzle data not found for: " + puzzleId);
    return;
  }
  showPuzzleEditor(puzzleId);
}

async function savePuzzle() {
  const puzzleName = document.getElementById("puzzleName").value.trim();
  let puzzleId = currentEditingPuzzle;

  if (!puzzleId) {
    puzzleId = puzzleName.toLowerCase().replace(/\s+/g, "_");

    let counter = 1;
    const originalId = puzzleId;
    while (puzzleData[puzzleId]) {
      puzzleId = `${originalId}_${counter++}`;
    }
  }

  const type = document.getElementById("puzzleType").value;
  const hasAnswer = document.getElementById("puzzleHasAnswer").checked;
  const roomId = document.getElementById("puzzleRoom").value.trim();

  const currentPuzzle = puzzleData[puzzleId] || {};

  const hints = [];
  document.querySelectorAll(".hint-entry").forEach((entry) => {
    const problem = entry.querySelector(".hint-problem").value.trim();
    const text = entry.querySelector(".hint-text").value.trim();
    if (problem && text) {
      hints.push({
        problem: problem,
        text: text,
      });
    }
  });

  const puzzle = {
    name: puzzleName,
    type: type,
    hasAnswer: hasAnswer,
    hints: hints,
  };

  if (roomId) {
    if (currentPuzzle.room && currentPuzzle.room !== roomId) {
      const oldRoom = roomData[currentPuzzle.room];
      if (oldRoom && oldRoom.puzzles) {
        oldRoom.puzzles = oldRoom.puzzles.filter((p) => p !== puzzleId);
      }
    }

    if (!roomData[roomId]) roomData[roomId] = {};
    if (!roomData[roomId].puzzles) roomData[roomId].puzzles = [];
    if (!roomData[roomId].puzzles.includes(puzzleId)) {
      roomData[roomId].puzzles.push(puzzleId);
    }
    puzzle.room = roomId;
  } else if (currentPuzzle.room) {
    const oldRoom = roomData[currentPuzzle.room];
    if (oldRoom && oldRoom.puzzles) {
      oldRoom.puzzles = oldRoom.puzzles.filter((p) => p !== puzzleId);
    }
  }

  if (hasAnswer) {
  const answersText = document.getElementById("puzzleAnswers").value.trim();
  if (answersText) {
    puzzle.answers = answersText.split(",").map(a => encryptAnswer(a.trim()));
  } else {
    puzzle.answers = [];
  }

    puzzle.maxGuesses =
      parseInt(document.getElementById("puzzleMaxGuesses").value) || 0;

      puzzle.requiredCorrect =
        parseInt(document.getElementById("puzzleRequiredCorrect").value) || 1;
  }

  const bindings = [];
  document.querySelectorAll("#answerBindingsContainer .form-row").forEach(row => {
    const isSolveBinding = row.querySelector(".binding-solve").checked;
    const answer = isSolveBinding ? '' : row.querySelector(".binding-answer").value.trim();
    const target = row.querySelector(".binding-target").value;
    if (target) {
      bindings.push({
        answer: isSolveBinding ? 'SOLVE_BINDING' : (answer ? encryptAnswer(answer) : ''),
        targetPuzzle: target,
        isSolveBinding
      });
    }
  });
  if (bindings.length > 0) {
    puzzle.answerBindings = bindings;
  }
    const events = [];
  document.querySelectorAll("#puzzleEventsContainer .form-row").forEach(row => {
    const trigger = row.querySelector(".event-trigger").value;
    const triggerValue = trigger === 'answer' 
      ? row.querySelector(".event-trigger-value").value.trim()
      : '';
    const action = row.querySelector(".event-action").value;
    let actionValue = action === 'notify'
      ? row.querySelector(".event-notify-value").value.trim()
      : row.querySelector(".event-action-value").value;
    
    if (actionValue) {
      events.push({
        trigger,
        triggerValue: triggerValue ? encryptAnswer(triggerValue) : '',
        action,
        actionValue
      });
    }
  });
  if (events.length > 0) {
    puzzle.events = events;
  }

  if (currentPuzzle.position) {
    puzzle.position = {
      ...currentPuzzle.position,
      x:
        parseInt(document.getElementById("puzzlePositionX").value) ||
        currentPuzzle.position.x ||
        100,
      y:
        parseInt(document.getElementById("puzzlePositionY").value) ||
        currentPuzzle.position.y ||
        100,
      rotation:
        parseInt(document.getElementById("puzzleRotation").value) ||
        currentPuzzle.position.rotation ||
        0,
    };
  } else {
    puzzle.position = {
      x: parseInt(document.getElementById("puzzlePositionX").value) || 100,
      y: parseInt(document.getElementById("puzzlePositionY").value) || 100,
      rotation: parseInt(document.getElementById("puzzleRotation").value) || 0,
    };
  }

  const hasPdf = Array.from(document.querySelectorAll(".media-item")).some(
    (item) => item.dataset.type === "pdf"
  );

  if (!hasPdf) {
    alert("At least one PDF is required for the puzzle");
    return;
  }

  const media = Array.from(document.querySelectorAll(".media-item")).map(
    (item) => ({
      type: item.dataset.type,
      url: item.dataset.url,
      order: Array.from(item.parentNode.children).indexOf(item),
    })
  );

  puzzle.media = media;
  if (currentPuzzle.description) puzzle.description = currentPuzzle.description;
  if (currentPuzzle.solveMessage)
    puzzle.solveMessage = currentPuzzle.solveMessage;

  if (type === "lock") {
    puzzle.description = document
      .getElementById("puzzleDescription")
      .value.trim();
  }

  const followup = document.getElementById("puzzleFollowup").value.trim();
  if (followup) puzzle.followup = followup;

  const unlocks = document.getElementById("puzzleUnlocks").value.trim();
  if (unlocks) puzzle.unlocks = unlocks;

  const solveMessage = document
    .getElementById("puzzleSolveMessage")
    .value.trim();
  if (solveMessage) puzzle.solveMessage = solveMessage;

  try {
    puzzleData[puzzleId] = puzzle;
    await Promise.all([
      db.collection("puzzles").doc("config").set(puzzleData),
      db.collection("rooms").doc("config").set(roomData),
    ]);

    closePuzzleEditor();
    loadDiagramData();
    alert("Puzzle saved successfully!");
  } catch (error) {
    console.error("Error saving puzzle:", error);
    alert("Error saving puzzle: " + error.message);
  }
}

async function deletePuzzle() {
  if (!currentEditingPuzzle) return;

  if (
    !confirm(
      `Are you sure you want to delete puzzle "${currentEditingPuzzle}"?`
    )
  ) {
    return;
  }

  try {
    delete puzzleData[currentEditingPuzzle];
    await db.collection("puzzles").doc("config").set(puzzleData);
    closePuzzleEditor();
    loadDiagramData();
    alert("Puzzle deleted successfully!");
  } catch (error) {
    console.error("Error deleting puzzle:", error);
    alert("Error deleting puzzle: " + error.message);
  }
}

function showRoomEditor(roomId = null) {
  isUserEditing = true;
  currentEditingRoom = roomId;
  const modal = document.getElementById("roomEditor");
  const title = document.getElementById("roomEditorTitle");
  const deleteBtn = document.getElementById("deleteRoomBtn");

  if (roomId && roomData[roomId]) {
    title.textContent = "Edit Room";
    deleteBtn.style.display = "inline-block";
    fillRoomEditor(roomData[roomId]);
  } else {
    title.textContent = "Add New Room";
    deleteBtn.style.display = "none";
    clearRoomEditor();
  }

  populateClearUnlockDropdown();
  modal.style.display = "block";
  updateClearConditionFields();
}

function fillRoomEditor(room) {
  document.getElementById("roomName").value = room.name || "";
  document.getElementById("roomType").value = room.type || "normal";
  document.getElementById("roomBackground").value = room.background || "";
  document.getElementById("roomClearCondition").value =
    room.clearCondition || "fullsolve";
  document.getElementById("roomClearCount").value = room.clearCount || 1;
  const eventsContainer = document.getElementById("roomEventsContainer");
  eventsContainer.innerHTML = "";
  if (room.events) {
    room.events.forEach(event => {
      addRoomEvent(
        event.triggerType,
        event.triggerValue,
        event.puzzles || [],
        event.action,
        event.actionValue
      );
    });
  }
  document.getElementById("roomPuzzles").value = (room.puzzles || []).join(
    ", "
  );
  document.getElementById("roomDescription").value = room.description || "";
}

function clearRoomEditor() {
  document.getElementById("roomName").value = "";
  document.getElementById("roomType").value = "normal";
  document.getElementById("roomBackground").value = "";
  document.getElementById("roomClearCondition").value = "fullsolve";
  document.getElementById("roomClearCount").value = 1;
  document.getElementById("roomPuzzles").value = "";
}

function updateClearConditionFields() {
  const condition = document.getElementById("roomClearCondition").value;
  const countField = document.getElementById("partialSolveCount");
  const mustSolveGroup = document.getElementById("mustSolvePuzzlesGroup");

  countField.classList.add("hidden");
  mustSolveGroup.classList.add("hidden");

  if (condition === "partialsolve") {
    countField.classList.remove("hidden");
  } else if (condition === "mustsolve") {
    mustSolveGroup.classList.remove("hidden");
    populateMustSolvePuzzles();
  }
}
function populateMustSolvePuzzles() {
  const select = document.getElementById("roomMustSolvePuzzles");
  select.innerHTML = "";

  Object.keys(puzzleData).forEach((puzzleId) => {
    const puzzle = puzzleData[puzzleId];
    const option = document.createElement("option");
    option.value = puzzleId;
    option.textContent = puzzle.name || puzzleId;
    select.appendChild(option);
  });

  if (currentEditingRoom && roomData[currentEditingRoom]?.mustSolvePuzzles) {
    roomData[currentEditingRoom].mustSolvePuzzles.forEach((puzzleId) => {
      const option = select.querySelector(`option[value="${puzzleId}"]`);
      if (option) option.selected = true;
    });
  }
}

function populateClearUnlockDropdown() {
  const select = document.getElementById("roomClearUnlock");
  select.innerHTML = '<option value="">-- None --</option>';

  select.innerHTML += '<optgroup label="Rooms">';
  Object.keys(roomData).forEach((roomId) => {
    if (roomId !== currentEditingRoom) {
      select.innerHTML += `<option value="room:${roomId}">Room: ${
        roomData[roomId].name || roomId
      }</option>`;
    }
  });

  select.innerHTML += '<optgroup label="Puzzles">';
  Object.keys(puzzleData).forEach((puzzleId) => {
    select.innerHTML += `<option value="puzzle:${puzzleId}">Puzzle: ${
      puzzleData[puzzleId].name || puzzleId
    }</option>`;
  });

  if (currentEditingRoom && roomData[currentEditingRoom]?.clearUnlock) {
    const clearUnlock = roomData[currentEditingRoom].clearUnlock;
    const value =
      clearUnlock.type === "room"
        ? `room:${clearUnlock.id}`
        : `puzzle:${clearUnlock.id}`;
    select.value = value;
  }
}

function closeRoomEditor() {
  isUserEditing = false;
  document.getElementById("roomEditor").style.display = "none";
  currentEditingRoom = null;
}

function editRoom(roomId) {
  showRoomEditor(roomId);
}

async function saveRoom() {
  let roomId = currentEditingRoom;
  const roomName = document.getElementById("roomName").value.trim();

  if (!roomId) {
    roomId = roomName.toLowerCase().replace(/\s+/g, "_");

    let counter = 1;
    const originalId = roomId;
    while (roomData[roomId]) {
      roomId = `${originalId}_${counter++}`;
    }
  }

  const room = {
    name: roomName,
    type: document.getElementById("roomType").value,
    background: document.getElementById("roomBackground").value.trim(),
    clearCondition: document.getElementById("roomClearCondition").value,
  };

  if (room.clearCondition === "partialsolve") {
    room.clearCount =
      parseInt(document.getElementById("roomClearCount").value) || 1;
  } else if (room.clearCondition === "mustsolve") {
    const select = document.getElementById("roomMustSolvePuzzles");
    room.mustSolvePuzzles = Array.from(select.selectedOptions).map(
      (option) => option.value
    );
  }

  const clearUnlockValue = document.getElementById("roomClearUnlock").value;
  if (clearUnlockValue) {
    const [type, id] = clearUnlockValue.split(":");
    room.clearUnlock = { type, id };
  }
  const events = [];
  document.querySelectorAll("#roomEventsContainer .form-row").forEach(row => {
    const triggerType = row.querySelector(".event-trigger-type").value;
    let triggerValue, puzzles = [];
    if (triggerType === 'solveCount') {
      triggerValue = row.querySelector(".event-trigger-value").value.trim();
    } else { // specificPuzzles
      puzzles = Array.from(row.querySelector(".event-trigger-puzzles").selectedOptions)
        .map(opt => opt.value);
    }
    
    const action = row.querySelector(".event-action").value;
    let actionValue = action === 'notify'
      ? row.querySelector(".event-notify-value").value.trim()
      : row.querySelector(".event-action-value").value;
    
    if ((triggerType === 'solveCount' && triggerValue) || 
        (triggerType === 'specificPuzzles' && puzzles.length > 0)) {
      events.push({
        triggerType,
        triggerValue: triggerType === 'solveCount' ? triggerValue : '',
        puzzles: triggerType === 'specificPuzzles' ? puzzles : [],
        action,
        actionValue
      });
    }
  });
  if (events.length > 0) {
    room.events = events;
  }

  const puzzlesText = document.getElementById("roomPuzzles").value.trim();
  room.puzzles = puzzlesText ? puzzlesText.split(",").map((p) => p.trim()) : [];
  room.description = document.getElementById("roomDescription").value.trim();

  try {
    roomData[roomId] = room;
    await db.collection("rooms").doc("config").set(roomData);
    closeRoomEditor();
    loadDiagramData();
    alert("Room saved successfully!");
  } catch (error) {
    console.error("Error saving room:", error);
    alert("Error saving room: " + error.message);
  }
}
async function deleteRoom() {
  if (!currentEditingRoom) return;

  if (
    !confirm(`Are you sure you want to delete room "${currentEditingRoom}"?`)
  ) {
    return;
  }

  try {
    delete roomData[currentEditingRoom];
    await db.collection("rooms").doc("config").set(roomData);
    closeRoomEditor();
    loadDiagramData();
    alert("Room deleted successfully!");
  } catch (error) {
    console.error("Error deleting room:", error);
    alert("Error deleting room: " + error.message);
  }
}

function generateId() {
  return "item_" + Math.random().toString(36).substr(2, 9);
}

function addMedia() {
  const type = document.getElementById("mediaType").value;
  const url = document.getElementById("mediaUrl").value.trim();

  if (!url) {
    alert("Please enter a URL");
    return;
  }

  try {
    new URL(url);
  } catch (e) {
    alert("Please enter a valid URL");
    return;
  }

  const mediaList = document.getElementById("mediaList");
  const mediaId = `media_${Date.now()}`;

  const mediaItem = document.createElement("div");
  mediaItem.className = "media-item";
  mediaItem.id = mediaId;
  mediaItem.dataset.type = type;
  mediaItem.dataset.url = url;

  let previewContent = "";
  if (type === "pdf") {
    previewContent = `<i class="fas fa-file-pdf" style="font-size: 40px; color: #e74c3c; display: block; text-align: center;"></i>`;
  } else if (type === "sheet") {
    previewContent = `<i class="fas fa-table" style="font-size: 40px; color: #2ecc71; display: block; text-align: center;"></i>`;
  } else {
    previewContent = `<img src="${url}" onerror="this.parentNode.remove()" style="max-width: 100px; max-height: 80px;">`;
  }

  mediaItem.innerHTML = `
    ${previewContent}
    <div class="media-type">${type.toUpperCase()}</div>
    <div class="media-actions">
      <button onclick="moveMediaUp('${mediaId}')">↑</button>
      <button onclick="moveMediaDown('${mediaId}')">↓</button>
      <button onclick="removeMedia('${mediaId}')">×</button>
    </div>
  `;

  mediaList.appendChild(mediaItem);
  document.getElementById("mediaUrl").value = "";
  checkPdfRequirement();
}

function removeMedia(mediaId) {
  const item = document.getElementById(mediaId);
  if (item) {
    item.remove();
    checkPdfRequirement();
  }
}

function moveMediaUp(mediaId) {
  const item = document.getElementById(mediaId);
  if (item && item.previousElementSibling) {
    item.parentNode.insertBefore(item, item.previousElementSibling);
  }
}

function moveMediaDown(mediaId) {
  const item = document.getElementById(mediaId);
  if (item && item.nextElementSibling) {
    item.parentNode.insertBefore(item.nextElementSibling, item);
  }
}

function checkPdfRequirement() {
  const hasPdf = Array.from(document.querySelectorAll(".media-item")).some(
    (item) => item.dataset.type === "pdf"
  );

  const warning = document.getElementById("pdfWarning");
  if (hasPdf) {
    warning.classList.add("hidden");
  } else {
    warning.classList.remove("hidden");
  }
}

window.onclick = function (event) {
  const puzzleModal = document.getElementById("puzzleEditor");
  const roomModal = document.getElementById("roomEditor");

  if (event.target === puzzleModal) {
    closePuzzleEditor();
  }
  if (event.target === roomModal) {
    closeRoomEditor();
  }
};

document.addEventListener("DOMContentLoaded", function () {
  showAdminSection("mindmap");
});

function checkUserEditing() {
  const modals = ["puzzleEditor", "roomEditor"];
  return modals.some(
    (modalId) => document.getElementById(modalId).style.display === "block"
  );
}

function generateDataHash(puzzleData, roomData) {
  const dataString = JSON.stringify({
    puzzles: puzzleData,
    rooms: roomData,
  });
  return CryptoJS.SHA256(dataString).toString();
}

async function refreshAllData(forceRefresh = false) {
  try {
    if (!forceRefresh && checkUserEditing()) {
      return;
    }
    const wasEditingPuzzle = currentEditingPuzzle;
    const wasEditingRoom = currentEditingRoom;
    const selectedTeamId = selectedTeam?.id;

    const [puzzlesDoc, roomsDoc] = await Promise.all([
      db.collection("puzzles").doc("config").get(),
      db.collection("rooms").doc("config").get(),
    ]);

    const newPuzzleData = puzzlesDoc.exists ? puzzlesDoc.data() : {};
    const newRoomData = roomsDoc.exists ? roomsDoc.data() : {};

    const newDataHash = generateDataHash(newPuzzleData, newRoomData);

    if (!forceRefresh && lastDataHash === newDataHash) {
      return;
    }

    lastDataHash = newDataHash;

    puzzleData = newPuzzleData;
    roomData = newRoomData;

    const mindmapSection = document.getElementById("admin-mindmap");
    if (!mindmapSection.classList.contains("hidden") && !checkUserEditing()) {
      loadDiagramData();
    }

    const progressSection = document.getElementById("admin-progress");
    if (!progressSection.classList.contains("hidden")) {
      await loadTeamProgress();

      if (selectedTeamId) {
        const teamCards = document.querySelectorAll(".team-card");
        teamCards.forEach((card) => {
          if (card.textContent.includes(selectedTeamId)) {
            card.click();
          }
        });
      }
    }

    if (
      teamDiagram &&
      document.getElementById("teamMindmapModal").style.display === "block"
    ) {
      initializeTeamMindmap();
    }

    if (document.getElementById("puzzleEditor").style.display === "block") {
      updatePuzzleEditorDropdowns();
    }

    if (document.getElementById("roomEditor").style.display === "block") {
      updateRoomEditorDropdowns();
    }
  } catch (error) {
    console.error("Error refreshing data:", error);
  }
}

function updatePuzzleEditorDropdowns() {
  const roomSelect = document.getElementById("puzzleRoom");
  const currentRoomValue = roomSelect.value;

  roomSelect.innerHTML = '<option value="">-- Select Room --</option>';
  Object.keys(roomData).forEach((roomId) => {
    roomSelect.innerHTML += `<option value="${roomId}">${
      roomData[roomId].name || roomId
    }</option>`;
  });
  roomSelect.value = currentRoomValue;

  const followupSelect = document.getElementById("puzzleFollowup");
  const currentFollowupValue = followupSelect.value;

  followupSelect.innerHTML =
    '<option value="">-- Select Follow-up Puzzle --</option>';
  Object.keys(puzzleData).forEach((pId) => {
    if (pId !== currentEditingPuzzle) {
      followupSelect.innerHTML += `<option value="${pId}">${
        puzzleData[pId].name || pId
      }</option>`;
    }
  });
  followupSelect.value = currentFollowupValue;

  const unlocksSelect = document.getElementById("puzzleUnlocks");
  const currentUnlocksValue = unlocksSelect.value;

  unlocksSelect.innerHTML = '<option value="">-- Select Unlocks --</option>';
  unlocksSelect.innerHTML += '<optgroup label="Rooms">';
  Object.keys(roomData).forEach((roomId) => {
    unlocksSelect.innerHTML += `<option value="${roomId}">Room: ${
      roomData[roomId].name || roomId
    }</option>`;
  });
  unlocksSelect.innerHTML += '<optgroup label="Puzzles">';
  Object.keys(puzzleData).forEach((pId) => {
    if (pId !== currentEditingPuzzle) {
      unlocksSelect.innerHTML += `<option value="${pId}">Puzzle: ${
        puzzleData[pId].name || pId
      }</option>`;
    }
  });
  unlocksSelect.value = currentUnlocksValue;
}

function updateRoomEditorDropdowns() {
  populateClearUnlockDropdown();
  if (document.getElementById("roomClearCondition").value === "mustsolve") {
    populateMustSolvePuzzles();
  }
}

function manualRefresh() {
  refreshAllData(true);
}

function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  autoRefreshInterval = setInterval(() => {
    refreshAllData(false);
  }, 300000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log("Auto-refresh stopped");
  }
}

function encryptAnswer(answer) {
  return CryptoJS.AES.encrypt(answer, SECURITY_SALT).toString();
}

function decryptAnswer(encryptedAnswer) {
  try {
    return CryptoJS.AES.decrypt(encryptedAnswer, SECURITY_SALT).toString(
      CryptoJS.enc.Utf8
    );
  } catch (e) {
    console.error("Decryption error:", e);
    return "";
  }
}

function addAnswerBinding(answer = '', targetPuzzle = '', isSolveBinding = false) {
  const container = document.getElementById("answerBindingsContainer");
  const div = document.createElement("div");
  div.className = "form-row";
  div.innerHTML = `
    <input type="text" placeholder="Answer (leave empty for any)" 
           value="${answer}" class="binding-answer"
           ${isSolveBinding ? 'disabled' : ''}>
    <select class="binding-target">
      <option value="">-- Select Target Puzzle --</option>
      ${Object.keys(puzzleData).map(pId => 
        `<option value="${pId}" ${targetPuzzle === pId ? 'selected' : ''}>
          ${puzzleData[pId].name || pId}
        </option>`
      ).join('')}
    </select>
    <label class="binding-checkbox">
      <input type="checkbox" class="binding-solve" ${isSolveBinding ? 'checked' : ''}>
      On Solve
    </label>
    <button class="btn btn-sm btn-danger" onclick="removeAnswerBinding(this)">×</button>
  `;
  
  // Add event listener for the checkbox
  div.querySelector('.binding-solve').addEventListener('change', function() {
    const answerInput = div.querySelector('.binding-answer');
    if (this.checked) {
      answerInput.disabled = true;
      answerInput.value = '';
    } else {
      answerInput.disabled = false;
    }
  });
  
  container.appendChild(div);
}

function removeAnswerBinding(btn) {
  btn.closest(".form-row").remove();
}

function addPuzzleEvent(trigger = '', action = '', value = '') {
  const container = document.getElementById("puzzleEventsContainer");
  const div = document.createElement("div");
  div.className = "form-row";
  div.innerHTML = `
    <select class="event-trigger">
      <option value="answer" ${trigger === 'answer' ? 'selected' : ''}>On specific answer</option>
      <option value="solve" ${trigger === 'solve' ? 'selected' : ''}>On solve</option>
    </select>
    <input type="text" class="event-trigger-value" placeholder="Answer (if applicable)" value="${trigger === 'answer' ? value : ''}">
    <select class="event-action">
      <option value="unlock" ${action === 'unlock' ? 'selected' : ''}>Unlock puzzle</option>
      <option value="notify" ${action === 'notify' ? 'selected' : ''}>Show notification</option>
      <option value="solve" ${action === 'solve' ? 'selected' : ''}>Solve puzzle</option>
    </select>
    <select class="event-action-value">
      <option value="">-- Select target --</option>
      ${Object.keys(puzzleData).map(pId => 
        `<option value="${pId}" ${value === pId && action !== 'notify' ? 'selected' : ''}>
          ${puzzleData[pId].name || pId}
        </option>`
      ).join('')}
    </select>
    <input type="text" class="event-notify-value" placeholder="Notification text" 
      value="${action === 'notify' ? value : ''}" 
      style="${action === 'notify' ? '' : 'display:none'}">
    <button class="btn btn-sm btn-danger" onclick="removePuzzleEvent(this)">×</button>
  `;
  
  // Add event listeners for dynamic fields
  div.querySelector('.event-action').addEventListener('change', function() {
    const isNotify = this.value === 'notify';
    div.querySelector('.event-action-value').style.display = isNotify ? 'none' : 'inline-block';
    div.querySelector('.event-notify-value').style.display = isNotify ? 'inline-block' : 'none';
  });
  
  div.querySelector('.event-trigger').addEventListener('change', function() {
    div.querySelector('.event-trigger-value').style.display = 
      this.value === 'answer' ? 'inline-block' : 'none';
  });
  
  container.appendChild(div);
}

function removePuzzleEvent(btn) {
  btn.closest(".form-row").remove();
}

function addRoomEvent(triggerType = 'solveCount', triggerValue = '1', puzzles = [], action = 'unlock', actionValue = '') {
  const container = document.getElementById("roomEventsContainer");
  const div = document.createElement("div");
  div.className = "form-row";
  div.innerHTML = `
    <select class="event-trigger-type">
      <option value="solveCount" ${triggerType === 'solveCount' ? 'selected' : ''}>When # puzzles solved >=</option>
      <option value="specificPuzzles" ${triggerType === 'specificPuzzles' ? 'selected' : ''}>When specific puzzles solved</option>
    </select>
    <input type="number" class="event-trigger-value" 
           value="${triggerType === 'solveCount' ? triggerValue : '1'}" 
           min="1"
           placeholder="Count"
           style="${triggerType === 'specificPuzzles' ? 'display:none' : ''}">
    <select class="event-trigger-puzzles" multiple
            style="${triggerType === 'solveCount' ? 'display:none' : ''}; height: ${triggerType === 'specificPuzzles' ? '100px' : 'auto'}">
      ${Object.keys(puzzleData).map(pId => 
        `<option value="${pId}" ${puzzles.includes(pId) ? 'selected' : ''}>
          ${puzzleData[pId].name || pId}
        </option>`
      ).join('')}
    </select>
    <select class="event-action">
      <option value="unlock" ${action === 'unlock' ? 'selected' : ''}>Unlock puzzle</option>
      <option value="notify" ${action === 'notify' ? 'selected' : ''}>Show notification</option>
      <option value="solve" ${action === 'solve' ? 'selected' : ''}>Solve puzzle</option>
    </select>
    <select class="event-action-value">
      <option value="">-- Select target --</option>
      ${Object.keys(puzzleData).map(pId => 
        `<option value="${pId}" ${actionValue === pId && action !== 'notify' ? 'selected' : ''}>
          ${puzzleData[pId].name || pId}
        </option>`
      ).join('')}
    </select>
    <input type="text" class="event-notify-value" placeholder="Notification text" 
           value="${action === 'notify' ? actionValue : ''}" 
           style="${action === 'notify' ? '' : 'display:none'}">
    <button class="btn btn-sm btn-danger" onclick="removeRoomEvent(this)">×</button>
  `;
  
  // Add event listeners for dynamic fields
  div.querySelector('.event-action').addEventListener('change', function() {
    const isNotify = this.value === 'notify';
    div.querySelector('.event-action-value').style.display = isNotify ? 'none' : 'inline-block';
    div.querySelector('.event-notify-value').style.display = isNotify ? 'inline-block' : 'none';
  });
  
  div.querySelector('.event-trigger-type').addEventListener('change', function() {
    const isSpecificPuzzles = this.value === 'specificPuzzles';
    div.querySelector('.event-trigger-value').style.display = isSpecificPuzzles ? 'none' : 'inline-block';
    div.querySelector('.event-trigger-puzzles').style.display = isSpecificPuzzles ? 'inline-block' : 'none';
    div.querySelector('.event-trigger-puzzles').style.height = isSpecificPuzzles ? '100px' : 'auto';
  });
  
  container.appendChild(div);
}

function removeRoomEvent(btn) {
  btn.closest(".form-row").remove();
}
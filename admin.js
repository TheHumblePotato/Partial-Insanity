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
const SECURITY_MESSAGE =
  "[Sorry, answers cannot be loaded for security reasons]";
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
  const errorDiv = docufment.getElementById("admin-error");
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
      defaultSpringLength: 80, // Reduced from 120
      defaultElectricalCharge: 100, // Reduced from 150
      defaultGravitationalMass: 0.5, // Add gravity to pull nodes together
    }),
    "toolManager.hoverDelay": 500,
    // Enable zoom and pan
    allowZoom: true,
    allowHorizontalScroll: true,
    allowVerticalScroll: true,
    initialContentAlignment: go.Spot.Center,
    // Set zoom limits
    "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
    minScale: 0.3,
    maxScale: 3.0,
    initialScale: 0.8, // Start zoomed out a bit
  });

  // Compact room group template
  diagram.groupTemplate = $(
    go.Group,
    "Vertical",
    {
      selectionChanged: function (group) {},
      ungroupable: true,
      layout: $(go.GridLayout, {
        wrappingColumn: 3, // More columns for compactness
        spacing: new go.Size(5, 5), // Reduced spacing
      }),
      click: function (e, group) {
        editRoom(group.data.key);
      },
    },
    $(
      go.TextBlock,
      {
        font: "bold 10pt sans-serif", // Smaller font
        editable: true,
        margin: new go.Margin(2, 4), // Reduced margin
      },
      new go.Binding("text", "name")
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        fill: "transparent",
        stroke: "#D2691E",
        strokeWidth: 2, // Reduced from 3
      }),
      $(go.Placeholder, { padding: 8 }) // Reduced padding
    )
  );

  // Flexible puzzle node template
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
        minSize: new go.Size(60, 40), // Minimum size
        maxSize: new go.Size(150, 60), // Maximum size
        strokeWidth: 1.5, // Slightly thinner border
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
      // Dynamic width based on text length
      new go.Binding("width", "name", function (name) {
        const baseWidth = 60;
        const charWidth = 6; // Approximate pixels per character
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
        margin: new go.Margin(4, 6), // Reduced margin
        font: "9px sans-serif", // Smaller font
        wrap: go.TextBlock.WrapFit,
        textAlign: "center",
        overflow: go.TextBlock.OverflowEllipsis, // Add ellipsis for long text
      },
      new go.Binding("text", "name")
    )
  );

  // Thinner links for compactness
  diagram.linkTemplate = $(
    go.Link,
    {
      routing: go.Link.AvoidsNodes,
      curve: go.Link.JumpOver,
      corner: 8, // Softer corners
    },
    $(go.Shape, { stroke: "#333", strokeWidth: 1.5 }), // Thinner lines
    $(go.Shape, {
      toArrow: "Standard",
      fill: "#333",
      stroke: null,
      scale: 0.8, // Smaller arrows
    })
  );

  // Compact room unlock links
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
        strokeWidth: 2, // Reduced from 3
        strokeDashArray: [6, 3], // Smaller dashes
      }),
      $(go.Shape, {
        toArrow: "Standard",
        fill: "#FF6B35",
        stroke: null,
        scale: 1.2, // Smaller than before
      })
    )
  );

  // Add zoom controls
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

    // Create room groups
    Object.entries(roomData).forEach(([roomId, room]) => {
      groups.push({
        key: roomId,
        isGroup: true,
        name: room.name || roomId,
        category: "room",
      });
    });

    // Create puzzle nodes
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

    // Add room-to-room links
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

    // Auto-fit after a short delay to ensure layout is complete
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
      defaultSpringLength: 80, // Reduced from 120
      defaultElectricalCharge: 100, // Reduced from 150
      defaultGravitationalMass: 0.5,
    }),
    // Enable zoom and pan
    allowZoom: true,
    allowHorizontalScroll: true,
    allowVerticalScroll: true,
    initialContentAlignment: go.Spot.Center,
    "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
    minScale: 0.3,
    maxScale: 3.0,
    initialScale: 0.8,
  });

  // Compact room group template for team mindmap
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
          return "#90EE90"; // Green for cleared
        if ((selectedTeam.progress.unlockedRooms || []).includes(data.key))
          return "#FFFF99"; // Yellow for unlocked
        return "#FF9999"; // Red for locked
      }),
      $(go.Placeholder, { padding: 8 })
    )
  );

  // Flexible puzzle node template for team mindmap
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
          return "#90EE90"; // Green for solved

        if (isPuzzleUnlockedForTeam(data.key)) return "#FFFF99"; // Yellow for unlocked but not solved

        return "#FF9999"; // Red for locked
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

  // Compact links for team mindmap
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

  // Compact room unlock links for team mindmap
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

  // Create room groups (same as puzzle mindmap)
  Object.entries(roomData).forEach(([id, room]) => {
    groups.push({
      key: id,
      isGroup: true,
      name: room.name || id,
      category: "room",
    });
  });

  // Create puzzle nodes (same structure as puzzle mindmap)
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

  // Add room-to-room links
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

  // Add zoom controls for team mindmap
  addZoomControls("teamMindmapDiagram", teamDiagram);

  teamDiagram.layoutDiagram(true);
}

function initializeDiagram() {
  const $ = go.GraphObject.make;
  diagram = $(go.Diagram, "mindmapDiagram", {
    "undoManager.isEnabled": true,
    layout: $(go.ForceDirectedLayout, {
      maxIterations: 300,
      defaultSpringLength: 80, // Reduced from 120
      defaultElectricalCharge: 100, // Reduced from 150
      defaultGravitationalMass: 0.5, // Add gravity to pull nodes together
    }),
    "toolManager.hoverDelay": 500,
    // Enable zoom and pan
    allowZoom: true,
    allowHorizontalScroll: true,
    allowVerticalScroll: true,
    initialContentAlignment: go.Spot.Center,
    // Set zoom limits
    "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
    minScale: 0.3,
    maxScale: 3.0,
    initialScale: 0.8, // Start zoomed out a bit
  });

  // Compact room group template
  diagram.groupTemplate = $(
    go.Group,
    "Vertical",
    {
      selectionChanged: function (group) {},
      ungroupable: true,
      layout: $(go.GridLayout, {
        wrappingColumn: 3, // More columns for compactness
        spacing: new go.Size(5, 5), // Reduced spacing
      }),
      click: function (e, group) {
        editRoom(group.data.key);
      },
    },
    $(
      go.TextBlock,
      {
        font: "bold 10pt sans-serif", // Smaller font
        editable: true,
        margin: new go.Margin(2, 4), // Reduced margin
      },
      new go.Binding("text", "name")
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        fill: "transparent",
        stroke: "#D2691E",
        strokeWidth: 2, // Reduced from 3
      }),
      $(go.Placeholder, { padding: 8 }) // Reduced padding
    )
  );

  // Flexible puzzle node template
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
        minSize: new go.Size(60, 40), // Minimum size
        maxSize: new go.Size(150, 60), // Maximum size
        strokeWidth: 1.5, // Slightly thinner border
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
      // Dynamic width based on text length
      new go.Binding("width", "name", function (name) {
        const baseWidth = 60;
        const charWidth = 6; // Approximate pixels per character
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
        margin: new go.Margin(4, 6), // Reduced margin
        font: "9px sans-serif", // Smaller font
        wrap: go.TextBlock.WrapFit,
        textAlign: "center",
        overflow: go.TextBlock.OverflowEllipsis, // Add ellipsis for long text
      },
      new go.Binding("text", "name")
    )
  );

  // Thinner links for compactness
  diagram.linkTemplate = $(
    go.Link,
    {
      routing: go.Link.AvoidsNodes,
      curve: go.Link.JumpOver,
      corner: 8, // Softer corners
    },
    $(go.Shape, { stroke: "#333", strokeWidth: 1.5 }), // Thinner lines
    $(go.Shape, {
      toArrow: "Standard",
      fill: "#333",
      stroke: null,
      scale: 0.8, // Smaller arrows
    })
  );

  // Compact room unlock links
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
        strokeWidth: 2, // Reduced from 3
        strokeDashArray: [6, 3], // Smaller dashes
      }),
      $(go.Shape, {
        toArrow: "Standard",
        fill: "#FF6B35",
        stroke: null,
        scale: 1.2, // Smaller than before
      })
    )
  );

  // Add zoom controls
  addZoomControls("mindmapDiagram", diagram);

  loadDiagramData();
}

function addZoomControls(containerId, diagramInstance) {
  const container = document.getElementById(containerId);

  // Remove existing zoom controls if any
  const existingControls = container.querySelector(".zoom-controls");
  if (existingControls) {
    existingControls.remove();
  }

  // Create zoom controls
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

// Zoom control functions
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
  document.getElementById("puzzleHasAnswer").checked =
    puzzle.hasAnswer !== false;

  document.getElementById("puzzleAnswers").value = puzzle.answers
    ? SECURITY_MESSAGE
    : "";

  document.getElementById("puzzleMaxGuesses").value = puzzle.maxGuesses || 3;
  document.getElementById("puzzleRequiredCorrect").value =
    puzzle.requiredCorrect || 1;
  document.getElementById("puzzleDescription").value = puzzle.description || "";
  document.getElementById("puzzlePdf").value = puzzle.pdf || "";
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
  document.getElementById("puzzleMaxGuesses").value = 3;
  document.getElementById("puzzleRequiredCorrect").value = 1;
  document.getElementById("puzzleDescription").value = "";
  document.getElementById("puzzlePdf").value = "";
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
  const pdfField = document.getElementById("pdfField");
  const requiredField = document.getElementById("requiredCorrectField");

  if (type === "lock") {
    lockDesc.classList.remove("hidden");
    pdfField.classList.add("hidden");
    requiredField.classList.remove("hidden");
  } else {
    lockDesc.classList.add("hidden");
    pdfField.classList.remove("hidden");
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
    if (answersText !== SECURITY_MESSAGE) {
      puzzle.answers = answersText
        ? answersText
            .split(",")
            .map((a) => CryptoJS.SHA256(a.trim() + SECURITY_SALT).toString())
        : [];
    } else if (currentPuzzle.answers) {
      puzzle.answers = currentPuzzle.answers;
    }

    puzzle.maxGuesses =
      parseInt(document.getElementById("puzzleMaxGuesses").value) || 0;

    if (type === "lock") {
      puzzle.requiredCorrect =
        parseInt(document.getElementById("puzzleRequiredCorrect").value) || 1;
    }
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

  if (currentPuzzle.pdf) puzzle.pdf = currentPuzzle.pdf;
  if (currentPuzzle.description) puzzle.description = currentPuzzle.description;
  if (currentPuzzle.solveMessage)
    puzzle.solveMessage = currentPuzzle.solveMessage;

  if (type === "lock") {
    puzzle.description = document
      .getElementById("puzzleDescription")
      .value.trim();
  } else {
    puzzle.pdf = document.getElementById("puzzlePdf").value.trim();
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

async function saveDiagramLayout() {
  try {
    const positions = {};
    diagram.nodes.each((node) => {
      const data = node.data;
      if (data.category === "room") {
        if (!roomData[data.key]) roomData[data.key] = {};
        roomData[data.key].position = {
          x: node.position.x,
          y: node.position.y,
        };
      } else {
        if (!puzzleData[data.key]) puzzleData[data.key] = {};
        puzzleData[data.key].position = {
          x: node.position.x,
          y: node.position.y,
          rotation: puzzleData[data.key].position?.rotation || 0,
        };
      }
    });

    await Promise.all([
      db.collection("puzzles").doc("config").set(puzzleData),
      db.collection("rooms").doc("config").set(roomData),
    ]);

    alert("Layout saved successfully!");
  } catch (error) {
    console.error("Error saving layout:", error);
    alert("Error saving layout: " + error.message);
  }
}

function resetDiagramLayout() {
  if (
    confirm(
      "Are you sure you want to reset the diagram layout? This will remove all custom positions."
    )
  ) {
    diagram.layout = go.GraphObject.make(go.ForceDirectedLayout, {
      maxIterations: 200,
      defaultSpringLength: 120,
      defaultElectricalCharge: 150,
    });
    diagram.layoutDiagram(true);
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
      console.log("Skipping auto-refresh: user is editing");
      return;
    }

    console.log("Refreshing data...");

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
      console.log("No data changes detected");
      return;
    }

    console.log("Data changes detected, updating...");
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

    console.log("Data refresh completed");
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
  console.log("Manual refresh triggered");
  refreshAllData(true);
}

function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  autoRefreshInterval = setInterval(() => {
    refreshAllData(false);
  }, 30000);

  console.log("Auto-refresh started (30 second interval)");
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log("Auto-refresh stopped");
  }
}

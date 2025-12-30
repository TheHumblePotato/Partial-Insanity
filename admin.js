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
const SECURITY_SALT = "partial-insanity-salt";
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
      // preload rules for quick access
      if (typeof loadRules === 'function') loadRules();
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
  errorDiv.style.background = "#ffebee";
  errorDiv.style.color = "#b91c1c";
  setTimeout(() => errorDiv.classList.add("hidden"), 5000);
}

function showAdminMessage(message) {
  const errorDiv = document.getElementById("admin-error");
  errorDiv.textContent = message;
  errorDiv.classList.remove("hidden");
  errorDiv.style.background = "#ecfdf5";
  errorDiv.style.color = "#065f46";
  setTimeout(() => errorDiv.classList.add("hidden"), 3000);
}

function showAdminSection(section) {
  document
    .querySelectorAll(".admin-section")
    .forEach((el) => el.classList.add("hidden"));
  document.getElementById(`admin-${section}`).classList.remove("hidden");
  if (section === "mindmap") {
    setTimeout(() => diagram && diagram.requestUpdate(), 100);
  } else if (section === "leaderboard") {
    loadLeaderboard();
  } else if (section === "issues") {
    loadAdminIssues();
  } else if (section === "rules") {
    loadRules();
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
      new go.Binding("text", "name"),
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        fill: "transparent",
        stroke: "#D2691E",
        strokeWidth: 2,
      }),
      $(go.Placeholder, { padding: 8 }),
    ),
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
          Math.min(150, name.length * charWidth + 20),
        );
        return calculatedWidth;
      }),
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
      new go.Binding("text", "name"),
    ),
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
    }),
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
      }),
    ),
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
      div.dataset.teamId = team.id;
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

  // mark the matching card as selected (if present)
  const teamCard = document.querySelector(`.team-card[data-team-id="${team.id}"]`);
  if (teamCard) teamCard.classList.add("selected");

  const content = document.getElementById("teamProgressContent");
  const progress = team.progress || {};

  const allPuzzles = Object.keys(puzzleData || {});
  const solvedPuzzles = progress.solvedPuzzles || [];

  // build puzzle grid once (no duplication)
  let puzzleGrid = `<div class="puzzle-grid">`;
  allPuzzles.forEach((puzzleId) => {
    const isSolved = solvedPuzzles.includes(puzzleId);
    const puzzle = puzzleData[puzzleId] || {};

    // determine unlocked at room level
    const isUnlockedRoom = (progress.unlockedRooms || []).includes(
      puzzle.room,
    );
    const statusClass = isSolved ? "status-solved" : isUnlockedRoom ? "status-unlocked" : "status-locked";

    puzzleGrid += `
      <div class="puzzle-preview ${statusClass}">
        <h5>${puzzle.name || puzzleId}</h5>
        <p class="meta-line">Type: ${puzzle.type || "puzzle"}</p>
        <p class="meta-line">Hints used: ${progress.hintUsage?.[puzzleId]?.length || 0}</p>
        <div class="set-status">
          <label>Set status:</label>
          <select onchange="updateTeamPuzzleStatus('${team.id}', '${puzzleId}', this.value)">
            <option value="locked" ${!isSolved && !isUnlockedRoom ? 'selected' : ''}>Locked</option>
            <option value="unlocked" ${!isSolved && isUnlockedRoom ? 'selected' : ''}>Unlocked</option>
            <option value="solved" ${isSolved ? 'selected' : ''}>Solved</option>
          </select>
        </div>
      </div>`;
  });
  puzzleGrid += `</div>`;

  // Rooms list with controls
  const roomsList = (Object.keys(roomData || {}) || []).map((r) => {
    const room = roomData[r] || {};
    const cleared = (progress.clearedRooms || []).includes(r);
    const unlocked = (progress.unlockedRooms || []).includes(r);
    return `
      <li class="room-item">
        <div class="room-name">${room.name || r}</div>
        <div class="room-controls">
          <select onchange="updateTeamRoomStatus('${team.id}', '${r}', this.value)">
            <option value="locked" ${!cleared && !unlocked ? 'selected' : ''}>Locked</option>
            <option value="unlocked" ${unlocked && !cleared ? 'selected' : ''}>Unlocked</option>
            <option value="cleared" ${cleared ? 'selected' : ''}>Cleared</option>
          </select>
        </div>
      </li>`;
  }).join('');

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
    <p><strong>Current Room:</strong> ${progress.currentRoom || "starting-room"}</p>

    <h5>Rooms (set status):</h5>
    <div class="rooms-box"><ul>${roomsList}</ul></div>

    <h5>Puzzle Status (set status):</h5>
    ${puzzleGrid}
  `;

  document.getElementById("teamDetails").classList.remove("hidden");
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
          roomId,
        );
        const isCleared = (selectedTeam.progress.clearedRooms || []).includes(
          roomId,
        );

        if (
          confirm(
            `${
              isCleared
                ? "Room is cleared. Lock it?"
                : isUnlocked
                  ? "Lock this room?"
                  : "Unlock this room?"
            }`,
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
      new go.Binding("text", "name"),
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
      $(go.Placeholder, { padding: 8 }),
    ),
  );

  teamDiagram.nodeTemplate = $(
    go.Node,
    "Auto",
    {
      click: function (e, node) {
        const puzzleId = node.data.key;
        const isDone = (selectedTeam.progress.solvedPuzzles || []).includes(
          puzzleId,
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
      new go.Binding("text", "name"),
    ),
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
    }),
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
      }),
    ),
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
      (selectedTeam.progress.solvedPuzzles || []).includes(p.key),
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
      selectedTeam.progress.unlockedRooms = Array.from(
        new Set([...(selectedTeam.progress.unlockedRooms || []), roomId])
      );
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
    showAdminError("Error updating room status");
  }
}

async function togglePuzzleStatus(puzzleId, done) {
  const teamRef = db.collection("progress").doc(selectedTeam.id);
  try {
    if (done) {
      await teamRef.update({
        solvedPuzzles: firebase.firestore.FieldValue.arrayUnion(puzzleId),
        lastSolveTime: Date.now()
      });
      // dedupe locally
      selectedTeam.progress.solvedPuzzles = Array.from(
        new Set([...(selectedTeam.progress.solvedPuzzles || []), puzzleId])
      );
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
    showAdminError("Error updating puzzle status");
  }
}

function updateTeamPuzzleStatus(teamId, puzzleId, status) {
  const teamRef = db.collection('progress').doc(teamId);
  const puzzle = puzzleData[puzzleId] || {};

  const updates = {};

  if (status === 'solved') {
    updates['solvedPuzzles'] = firebase.firestore.FieldValue.arrayUnion(puzzleId);
    updates['lastSolveTime'] = Date.now();
  } else if (status === 'unlocked') {
    updates['solvedPuzzles'] = firebase.firestore.FieldValue.arrayRemove(puzzleId);
    if (puzzle.room) {
      updates['unlockedRooms'] = firebase.firestore.FieldValue.arrayUnion(puzzle.room);
    }
  } else if (status === 'locked') {
    updates['solvedPuzzles'] = firebase.firestore.FieldValue.arrayRemove(puzzleId);
  }

  teamRef.update(updates).then(async () => {
    // refresh team progress and UI
    const teamDoc = await db.collection('teams').doc(teamId).get();
    const progressDoc = await teamRef.get();
    const team = {
      id: teamId,
      name: teamDoc.exists ? teamDoc.data().name : 'Unknown',
      email: teamDoc.exists ? teamDoc.data().email : 'N/A',
      progress: progressDoc.exists ? progressDoc.data() : {},
    };
    // reload team list and show details
    await loadTeamProgress();
    showTeamDetails(team);
  }).catch(err => {
    console.error('Error updating puzzle status for team:', err);
  });
}

function updateTeamRoomStatus(teamId, roomId, status) {
  const teamRef = db.collection('progress').doc(teamId);
  let updates = {};
  if (status === 'cleared') {
    updates['unlockedRooms'] = firebase.firestore.FieldValue.arrayUnion(roomId);
    updates['clearedRooms'] = firebase.firestore.FieldValue.arrayUnion(roomId);
  } else if (status === 'unlocked') {
    updates['unlockedRooms'] = firebase.firestore.FieldValue.arrayUnion(roomId);
    updates['clearedRooms'] = firebase.firestore.FieldValue.arrayRemove(roomId);
  } else if (status === 'locked') {
    updates['unlockedRooms'] = firebase.firestore.FieldValue.arrayRemove(roomId);
    updates['clearedRooms'] = firebase.firestore.FieldValue.arrayRemove(roomId);
  }

  teamRef.update(updates).then(async () => {
    const teamDoc = await db.collection('teams').doc(teamId).get();
    const progressDoc = await teamRef.get();
    const team = {
      id: teamId,
      name: teamDoc.exists ? teamDoc.data().name : 'Unknown',
      email: teamDoc.exists ? teamDoc.data().email : 'N/A',
      progress: progressDoc.exists ? progressDoc.data() : {},
    };
    await loadTeamProgress();
    showTeamDetails(team);
    if (teamDiagram) {
      teamDiagram.startTransaction('room status updated');
      teamDiagram.updateAllTargetBindings();
      teamDiagram.commitTransaction('room status updated');
    }
  }).catch(err => console.error('Error updating room status for team:', err));
}

function showTeamMindMap() {
  if (!selectedTeam) return;
  document.getElementById('teamMindmapName').textContent = selectedTeam.name || 'Team';
  document.getElementById('teamMindmapModal').style.display = 'block';
  initializeTeamMindmap();
}

function closeTeamMindmap() {
  document.getElementById('teamMindmapModal').style.display = 'none';
  if (teamDiagram) {
    teamDiagram.div = null;
    teamDiagram = null;
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
    puzzle.answers && puzzle.answers.length > 0;
  document.getElementById("puzzleAnswers").value = puzzle.answers
    ? puzzle.answers.map((a) => decryptAnswer(a)).join(", ")
    : "";
  toggleAnswerFields();
  const bindingsContainer = document.getElementById("answerBindingsContainer");
  bindingsContainer.innerHTML = "";
  if (puzzle.answerBindings) {
    puzzle.answerBindings.forEach((binding) => {
      addAnswerBinding(
        binding.isSolveBinding
          ? ""
          : binding.answer
            ? decryptAnswer(binding.answer)
            : "",
        binding.targetPuzzle,
        binding.isSolveBinding,
      );
    });
  }
  const eventsContainer = document.getElementById("puzzleEventsContainer");
  eventsContainer.innerHTML = "";
  if (puzzle.events) {
    puzzle.events.forEach((event) => {
      addPuzzleEvent(
        event.trigger,
        event.action,
        event.actionValue,
        event.triggerValue,
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
  document.getElementById("puzzleFollowup").value = "";
  document.getElementById("puzzleUnlocks").value = "";
  document.getElementById("puzzleSolveMessage").value = "";
  document.getElementById("puzzlePositionX").value = 100;
  document.getElementById("puzzlePositionY").value = 100;
  document.getElementById("puzzleRotation").value = 0;
  document.getElementById("answerBindingsContainer").innerHTML = ``;
  document.getElementById("puzzleEventsContainer").innerHTML = ``;
  document.getElementById("mediaList").innerHTML = ``;
  document.getElementById("hintsContainer").innerHTML = ``;
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
    requiredField.classList.remove("hidden");
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
    showAdminError("Puzzle data not found for: " + puzzleId);
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
      puzzle.answers = answersText
        .split(",")
        .map((a) => encryptAnswer(a.trim()));
    } else {
      puzzle.answers = [];
    }

    puzzle.maxGuesses =
      parseInt(document.getElementById("puzzleMaxGuesses").value) || 0;

    puzzle.requiredCorrect =
      parseInt(document.getElementById("puzzleRequiredCorrect").value) || 1;
  }

  const bindings = [];
  document
    .querySelectorAll("#answerBindingsContainer .form-row")
    .forEach((row) => {
      const isSolveBinding = row.querySelector(".binding-solve").checked;
      const answer = isSolveBinding
        ? ""
        : row.querySelector(".binding-answer").value.trim();
      const target = row.querySelector(".binding-target").value;
      if (target) {
        bindings.push({
          answer: isSolveBinding
            ? "SOLVE_BINDING"
            : answer
              ? encryptAnswer(answer)
              : "",
          targetPuzzle: target,
          isSolveBinding,
        });
      }
    });
  if (bindings.length > 0) {
    puzzle.answerBindings = bindings;
  }
  const events = [];
  document
    .querySelectorAll("#puzzleEventsContainer .form-row")
    .forEach((row) => {
      const trigger = row.querySelector(".event-trigger").value;
      const triggerValue =
        trigger === "answer"
          ? row.querySelector(".event-trigger-value").value.trim()
          : "";
      const action = row.querySelector(".event-action").value;
      let actionValue =
        action === "notify"
          ? row.querySelector(".event-notify-value").value.trim()
          : row.querySelector(".event-action-value").value;

      if (actionValue) {
        events.push({
          trigger,
          triggerValue: triggerValue ? encryptAnswer(triggerValue) : "",
          action,
          actionValue,
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
    (item) => item.dataset.type === "pdf",
  );

  if (!hasPdf) {
    showAdminError("At least one PDF is required for the puzzle");
    return;
  }

  const media = Array.from(document.querySelectorAll(".media-item")).map(
    (item) => {
      let url = item.dataset.url || "";
      if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) {
        url = `https://thehumblepotato.github.io/Partial-Insanity/${url.replace(/^\/+/, "")}`;
      }
      return {
        type: item.dataset.type,
        url,
        order: Array.from(item.parentNode.children).indexOf(item),
      };
    },
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
    showAdminMessage("Puzzle saved");
  } catch (error) {
    console.error("Error saving puzzle:", error);
    showAdminError("Error saving puzzle: " + error.message);
  }
}

async function deletePuzzle() {
  if (!currentEditingPuzzle) return;

  if (
    !confirm(
      `Are you sure you want to delete puzzle "${currentEditingPuzzle}"?`,
    )
  ) {
    return;
  }

  try {
    delete puzzleData[currentEditingPuzzle];
    await db.collection("puzzles").doc("config").set(puzzleData);
    closePuzzleEditor();
    loadDiagramData();
    showAdminMessage("Puzzle deleted");
  } catch (error) {
    console.error("Error deleting puzzle:", error);
    showAdminError("Error deleting puzzle: " + error.message);
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
    room.events.forEach((event) => {
      addRoomEvent(
        event.triggerType,
        event.triggerValue,
        event.puzzles || [],
        event.action,
        event.actionValue,
      );
    });
  }
  document.getElementById("roomPuzzles").value = (room.puzzles || []).join(
    ", ",
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
  document.getElementById("roomDescription").value = "";
  document.getElementById("roomEventsContainer").innerHTML = ``;
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
      (option) => option.value,
    );
  }

  const clearUnlockValue = document.getElementById("roomClearUnlock").value;
  if (clearUnlockValue) {
    const [type, id] = clearUnlockValue.split(":");
    room.clearUnlock = { type, id };
  }
  const events = [];
  document.querySelectorAll("#roomEventsContainer .form-row").forEach((row) => {
    const triggerType = row.querySelector(".event-trigger-type").value;
    let triggerValue,
      puzzles = [];
    if (triggerType === "solveCount") {
      triggerValue = row.querySelector(".event-trigger-value").value.trim();
    } else {
      puzzles = Array.from(
        row.querySelector(".event-trigger-puzzles").selectedOptions,
      ).map((opt) => opt.value);
    }

    const action = row.querySelector(".event-action").value;
    let actionValue =
      action === "notify"
        ? row.querySelector(".event-notify-value").value.trim()
        : row.querySelector(".event-action-value").value;

    if (
      (triggerType === "solveCount" && triggerValue) ||
      (triggerType === "specificPuzzles" && puzzles.length > 0)
    ) {
      events.push({
        triggerType,
        triggerValue: triggerType === "solveCount" ? triggerValue : "",
        puzzles: triggerType === "specificPuzzles" ? puzzles : [],
        action,
        actionValue,
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
    showAdminMessage("Room saved");
  } catch (error) {
    console.error("Error saving room:", error);
    showAdminError("Error saving room: " + error.message);
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
    showAdminMessage("Room deleted");
  } catch (error) {
    console.error("Error deleting room:", error);
    showAdminError("Error deleting room: " + error.message);
  }
}

function addMedia() {
  const type = document.getElementById("mediaType").value;
  const url = document.getElementById("mediaUrl").value.trim();

  if (!url) {
    showAdminError("Please enter a URL");
    return;
  }

  // If the user provided a relative path (no scheme), auto-prefix the public hosting base
  let finalUrl = url;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) {
    const trimmed = url.replace(/^\/+/, "");
    finalUrl = `https://thehumblepotato.github.io/Partial-Insanity/${trimmed}`;
    showAdminMessage("Auto-prefixed media URL: " + finalUrl);
  }

  try {
    new URL(finalUrl);
  } catch (e) {
    showAdminError("Please enter a valid URL");
    return;
  }

  const mediaList = document.getElementById("mediaList");
  const mediaId = `media_${Date.now()}`;

  const mediaItem = document.createElement("div");
  mediaItem.className = "media-item";
  mediaItem.id = mediaId;
  mediaItem.dataset.type = type;
  mediaItem.dataset.url = finalUrl;

  let previewContent = "";
  if (type === "pdf") {
    previewContent = `<i class="fas fa-file-pdf" style="font-size: 40px; color: #e74c3c; display: block; text-align: center;"></i>`;
  } else if (type === "sheet") {
    previewContent = `<i class="fas fa-table" style="font-size: 40px; color: #2ecc71; display: block; text-align: center;"></i>`;
  } else {
    previewContent = `<img src="${finalUrl}" onerror="this.parentNode.remove()" style="max-width: 100px; max-height: 80px;">`;
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
    (item) => item.dataset.type === "pdf",
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
    (modalId) => document.getElementById(modalId).style.display === "block",
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

    const leaderboardSection = document.getElementById("admin-leaderboard");
    if (!leaderboardSection.classList.contains("hidden")) {
      loadLeaderboard();
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

async function loadLeaderboard() {
  try {
    const loadingDiv = document.getElementById("admin-leaderboard-loading");
    const table = document.getElementById("admin-leaderboard-table");
    const emptyDiv = document.getElementById("admin-leaderboard-empty");
    const tbody = document.getElementById("admin-leaderboard-body");
    const statsDiv = document.getElementById("admin-leaderboard-stats");
    
    loadingDiv.style.display = "block";
    table.style.display = "none";
    emptyDiv.style.display = "none";
    tbody.innerHTML = "";
    statsDiv.innerHTML = "";

    const showOptedOut = document.getElementById("show-opted-out").checked;
    const showInactive = document.getElementById("show-inactive").checked;

    const teamsSnapshot = await db.collection("teams").get();
    const teams = [];

    for (const teamDoc of teamsSnapshot.docs) {
      const teamData = teamDoc.data();

      if (!showOptedOut && teamData.leaderboardOptOut) {
        continue;
      }

      const progressDoc = await db.collection("progress").doc(teamDoc.id).get();
      const progressData = progressDoc.exists ? progressDoc.data() : {};

      const roomsCleared = (progressData.clearedRooms || []).length;
      const puzzlesSolved = (progressData.solvedPuzzles || []).length;
      const unlockedRooms = (progressData.unlockedRooms || []).length;
      
      let lastSolveTime = null;
      let lastSolveTimeFormatted = "Never";
      if (progressData.lastSolveTime && progressData.lastSolveTime > 0) {
        lastSolveTime = progressData.lastSolveTime;
        const date = new Date(lastSolveTime);
        lastSolveTimeFormatted = date.toLocaleString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
      }

      const currentRoom = progressData.currentRoom || "starting-room";
      const currentRoomName = roomData[currentRoom]?.name || currentRoom;

      const isActive = puzzlesSolved > 0 || roomsCleared > 0;
      
      if (!showInactive && !isActive) {
        continue;
      }

      teams.push({
        id: teamDoc.id,
        name: teamData.name || "Unknown Team",
        email: teamData.email || "N/A",
        leaderboardOptOut: teamData.leaderboardOptOut || false,
        roomsCleared,
        puzzlesSolved,
        unlockedRooms,
        currentRoom,
        currentRoomName,
        lastSolveTime,
        lastSolveTimeFormatted,
        isActive,
        progress: progressData
      });
    }

    teams.sort((a, b) => {
      if (b.roomsCleared !== a.roomsCleared) {
        return b.roomsCleared - a.roomsCleared;
      }
      if (b.puzzlesSolved !== a.puzzlesSolved) {
        return b.puzzlesSolved - a.puzzlesSolved;
      }
      return (b.lastSolveTime || 0) - (a.lastSolveTime || 0);
    });

    // Calculate and display stats
    const totalTeams = teams.length;
    const activeTeams = teams.filter(t => t.isActive).length;
    const optedOutTeams = teams.filter(t => t.leaderboardOptOut).length;
    const totalRoomsCleared = teams.reduce((sum, t) => sum + t.roomsCleared, 0);
    const totalPuzzlesSolved = teams.reduce((sum, t) => sum + t.puzzlesSolved, 0);

    statsDiv.innerHTML = `
      <div class="admin-stat-card">
        <h3>${totalTeams}</h3>
        <p>Total Teams</p>
      </div>
      <div class="admin-stat-card">
        <h3>${activeTeams}</h3>
        <p>Active Teams</p>
      </div>
      <div class="admin-stat-card">
        <h3>${totalRoomsCleared}</h3>
        <p>Total Rooms Cleared</p>
      </div>
      <div class="admin-stat-card">
        <h3>${totalPuzzlesSolved}</h3>
        <p>Total Puzzles Solved</p>
      </div>
      <div class="admin-stat-card">
        <h3>${optedOutTeams}</h3>
        <p>Opted Out Teams</p>
      </div>
    `;

    loadingDiv.style.display = "none";

    if (teams.length === 0) {
      emptyDiv.style.display = "block";
      return;
    }

    table.style.display = "table";

    teams.forEach((team, index) => {
      const row = tbody.insertRow();
      const rank = index + 1;

      if (rank === 1) {
        row.classList.add("rank-1");
      } else if (rank === 2) {
        row.classList.add("rank-2");
      } else if (rank === 3) {
        row.classList.add("rank-3");
      }

      const statusBadge = team.leaderboardOptOut 
        ? '<span style="background: #ffc107; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 11px;">OPTED OUT</span>'
        : team.isActive 
          ? '<span style="background: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">ACTIVE</span>'
          : '<span style="background: #6c757d; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">INACTIVE</span>';

      row.innerHTML = `
        <td>${rank}</td>
        <td>
          <div>${team.name}</div>
          <div class="team-progress-details">ID: ${team.id}</div>
        </td>
        <td>
          <div>${team.email}</div>
        </td>
        <td>${team.roomsCleared}</td>
        <td>${team.puzzlesSolved}</td>
        <td>
          <div>${team.currentRoomName}</div>
          <div class="team-progress-details">${team.currentRoom}</div>
        </td>
        <td>${team.lastSolveTimeFormatted}</td>
        <td>${statusBadge}</td>
      `;

      // make row clickable to open team progress
      row.style.cursor = 'pointer';
      row.onclick = () => {
        showAdminSection('progress');
        showTeamDetails(team);
      };
    });

  } catch (error) {
    console.error("Error loading leaderboard:", error);
    const loadingDiv = document.getElementById("admin-leaderboard-loading");
    loadingDiv.textContent = "Error loading leaderboard data. Please try again.";
    loadingDiv.style.color = "#dc3545";
  }
}

function exportLeaderboard() {
  try {
    const table = document.getElementById("admin-leaderboard-table");
    if (table.style.display === "none") {
      showAdminError("No data to export. Please load the leaderboard first.");
      return;
    }

    let csv = "Rank,Team Name,Team Email,Rooms Cleared,Puzzles Solved,Current Room,Last Solve Time,Status\n";
    
    const rows = table.querySelectorAll("tbody tr");
    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      const rowData = [
        cells[0].textContent.trim(),
        cells[1].textContent.trim().split('\n')[0], // Team name only
        cells[2].textContent.trim(),
        cells[3].textContent.trim(),
        cells[4].textContent.trim(),
        cells[5].textContent.trim().split('\n')[0], // Current room name only
        cells[6].textContent.trim(),
        cells[7].textContent.trim()
      ];
      csv += rowData.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",") + "\n";
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leaderboard_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

  } catch (error) {
    console.error("Error exporting leaderboard:", error);
    showAdminError("Error exporting leaderboard. Please try again.");
  }
}

function encryptAnswer(answer) {
  return CryptoJS.AES.encrypt(answer, SECURITY_SALT).toString();
}

function decryptAnswer(encryptedAnswer) {
  try {
    return CryptoJS.AES.decrypt(encryptedAnswer, SECURITY_SALT).toString(
      CryptoJS.enc.Utf8,
    );
  } catch (e) {
    console.error("Decryption error:", e);
    return "";
  }
}

function addAnswerBinding(
  answer = "",
  targetPuzzle = "",
  isSolveBinding = false,
) {
  const container = document.getElementById("answerBindingsContainer");
  const div = document.createElement("div");
  div.className = "form-row";
  div.innerHTML = `
    <input type="text" placeholder="Answer (leave empty for any)" 
           value="${answer}" class="binding-answer"
           ${isSolveBinding ? "disabled" : ""}>
    <select class="binding-target">
      <option value="">-- Select Target Puzzle --</option>
      ${Object.keys(puzzleData)
        .map(
          (pId) =>
            `<option value="${pId}" ${targetPuzzle === pId ? "selected" : ""}>
          ${puzzleData[pId].name || pId}
        </option>`,
        )
        .join("")}
    </select>
    <label class="binding-checkbox">
      <input type="checkbox" class="binding-solve" ${
        isSolveBinding ? "checked" : ""
      }>
      On Solve
    </label>
    <button class="btn btn-sm btn-danger" onclick="removeAnswerBinding(this)">×</button>
  `;

  div.querySelector(".binding-solve").addEventListener("change", function () {
    const answerInput = div.querySelector(".binding-answer");
    if (this.checked) {
      answerInput.disabled = true;
      answerInput.value = "";
    } else {
      answerInput.disabled = false;
    }
  });

  container.appendChild(div);
}

function removeAnswerBinding(btn) {
  btn.closest(".form-row").remove();
}

function addPuzzleEvent(
  trigger = "",
  action = "",
  actionValue = "",
  triggerValue = "",
) {
  const container = document.getElementById("puzzleEventsContainer");
  const div = document.createElement("div");
  div.className = "form-row";
  div.innerHTML = `
    <select class="event-trigger">
      <option value="answer" ${
        trigger === "answer" ? "selected" : ""
      }>On specific answer</option>
      <option value="solve" ${
        trigger === "solve" ? "selected" : ""
      }>On solve</option>
    </select>
    <input type="text" class="event-trigger-value" placeholder="Answer (if applicable)" 
           value="${trigger === "answer" ? decryptAnswer(triggerValue) : ""}"
           style="${trigger === "answer" ? "" : "display:none"}">
    <select class="event-action">
      <option value="unlock" ${
        action === "unlock" ? "selected" : ""
      }>Unlock puzzle</option>
      <option value="notify" ${
        action === "notify" ? "selected" : ""
      }>Show notification</option>
      <option value="solve" ${
        action === "solve" ? "selected" : ""
      }>Solve puzzle</option>
    </select>
    <select class="event-action-value" style="${
      action === "notify" ? "display:none" : ""
    }">
      <option value="">-- Select target --</option>
      ${Object.keys(puzzleData)
        .map(
          (pId) =>
            `<option value="${pId}" ${
              actionValue === pId && action !== "notify" ? "selected" : ""
            }>
          ${puzzleData[pId].name || pId}
        </option>`,
        )
        .join("")}
    </select>
    <input type="text" class="event-notify-value" placeholder="Notification text" 
           value="${action === "notify" ? actionValue : ""}" 
           style="${action === "notify" ? "" : "display:none"}">
    <button class="btn btn-sm btn-danger" onclick="removePuzzleEvent(this)">×</button>
  `;

  div.querySelector(".event-action").addEventListener("change", function () {
    const isNotify = this.value === "notify";
    div.querySelector(".event-action-value").style.display = isNotify
      ? "none"
      : "inline-block";
    div.querySelector(".event-notify-value").style.display = isNotify
      ? "inline-block"
      : "none";
  });

  div.querySelector(".event-trigger").addEventListener("change", function () {
    div.querySelector(".event-trigger-value").style.display =
      this.value === "answer" ? "inline-block" : "none";
  });

  container.appendChild(div);
}

function removePuzzleEvent(btn) {
  btn.closest(".form-row").remove();
}

function addRoomEvent(
  triggerType = "solveCount",
  triggerValue = "1",
  puzzles = [],
  action = "unlock",
  actionValue = "",
) {
  const container = document.getElementById("roomEventsContainer");
  const div = document.createElement("div");
  div.className = "form-row";
  div.innerHTML = `
    <select class="event-trigger-type">
      <option value="solveCount" ${
        triggerType === "solveCount" ? "selected" : ""
      }>When # puzzles solved >=</option>
      <option value="specificPuzzles" ${
        triggerType === "specificPuzzles" ? "selected" : ""
      }>When specific puzzles solved</option>
    </select>
    <input type="number" class="event-trigger-value" 
           value="${triggerType === "solveCount" ? triggerValue : "1"}" 
           min="1"
           placeholder="Count"
           style="${triggerType === "specificPuzzles" ? "display:none" : ""}">
    <select class="event-trigger-puzzles" multiple
            style="${
              triggerType === "solveCount" ? "display:none" : ""
            }; height: ${triggerType === "specificPuzzles" ? "100px" : "auto"}">
      ${Object.keys(puzzleData)
        .map(
          (pId) =>
            `<option value="${pId}" ${puzzles.includes(pId) ? "selected" : ""}>
          ${puzzleData[pId].name || pId}
        </option>`,
        )
        .join("")}
    </select>
    <select class="event-action">
      <option value="unlock" ${
        action === "unlock" ? "selected" : ""
      }>Unlock puzzle</option>
      <option value="notify" ${
        action === "notify" ? "selected" : ""
      }>Show notification</option>
      <option value="solve" ${
        action === "solve" ? "selected" : ""
      }>Solve puzzle</option>
    </select>
    <select class="event-action-value">
      <option value="">-- Select target --</option>
      ${Object.keys(puzzleData)
        .map(
          (pId) =>
            `<option value="${pId}" ${
              actionValue === pId && action !== "notify" ? "selected" : ""
            }>
          ${puzzleData[pId].name || pId}
        </option>`,
        )
        .join("")}
    </select>
    <input type="text" class="event-notify-value" placeholder="Notification text" 
           value="${action === "notify" ? actionValue : ""}" 
           style="${action === "notify" ? "" : "display:none"}">
    <button class="btn btn-sm btn-danger" onclick="removeRoomEvent(this)">×</button>
  `;

  div.querySelector(".event-action").addEventListener("change", function () {
    const isNotify = this.value === "notify";
    div.querySelector(".event-action-value").style.display = isNotify
      ? "none"
      : "inline-block";
    div.querySelector(".event-notify-value").style.display = isNotify
      ? "inline-block"
      : "none";
  });

  div
    .querySelector(".event-trigger-type")
    .addEventListener("change", function () {
      const isSpecificPuzzles = this.value === "specificPuzzles";
      div.querySelector(".event-trigger-value").style.display =
        isSpecificPuzzles ? "none" : "inline-block";
      div.querySelector(".event-trigger-puzzles").style.display =
        isSpecificPuzzles ? "inline-block" : "none";
      div.querySelector(".event-trigger-puzzles").style.height =
        isSpecificPuzzles ? "100px" : "auto";
    });

  container.appendChild(div);
}

function removeRoomEvent(btn) {
  btn.closest(".form-row").remove();
}

function loadAdminLeaderboard() {
  const loading = document.getElementById("admin-leaderboard-loading");
  const table = document.getElementById("admin-leaderboard-table");
  const tbody = document.getElementById("admin-leaderboard-body");
  loading.style.display = "block";
  table.style.display = "none";
  tbody.innerHTML = "";

  db.collection("teams").get().then(async (teamsSnapshot) => {
    const teams = [];
    for (const teamDoc of teamsSnapshot.docs) {
      const teamData = teamDoc.data();
      if (teamData.leaderboardOptOut) continue;
      const progressDoc = await db.collection("progress").doc(teamDoc.id).get();
      if (progressDoc.exists) {
        const progressData = progressDoc.data();
        teams.push({
          id: teamDoc.id,
          name: teamData.name,
          roomsCleared: progressData.clearedRooms ? progressData.clearedRooms.length : 0,
          puzzlesSolved: progressData.solvedPuzzles ? progressData.solvedPuzzles.length : 0,
          lastSolveTime: progressData.lastSolveTime || 0
        });
      }
    }
    teams.sort((a, b) => b.roomsCleared - a.roomsCleared || b.puzzlesSolved - a.puzzlesSolved || b.lastSolveTime - a.lastSolveTime);
    teams.forEach((team, idx) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${idx + 1}</td>
        <td>${team.name}</td>
        <td>${team.roomsCleared}</td>
        <td>${team.puzzlesSolved}</td>
        <td>${team.lastSolveTime ? (new Date(team.lastSolveTime)).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "Never"}</td>
      `;
      tbody.appendChild(row);
    });
    loading.style.display = "none";
    table.style.display = "table";
  });
}

// --- ISSUES TAB (Admin) ---

function loadAdminIssues() {
  const list = document.getElementById("admin-issues-list");
  list.innerHTML = "Loading...";
  db.collection("issues").orderBy("timestamp", "desc").onSnapshot((snapshot) => {
    if (snapshot.empty) {
      list.innerHTML = "<p>No issues reported.</p>";
      return;
    }
    const active = [];
    const resolved = [];

    snapshot.forEach(doc => {
      const issue = doc.data();
      const entry = { id: doc.id, issue };
      // keep recently-resolved issues visible for a short moment so admin sees the change
      if (issue.status === 'resolved') {
        const updatedAt = issue.adminUpdatedAt || issue.resolvedAt || 0;
        if (Date.now() - updatedAt < 1000) active.push(entry);
        else resolved.push(entry);
      } else {
        active.push(entry);
      }
    });

    // clear and render
    list.innerHTML = "";

    const appendIssue = (entry) => {
      const { id, issue } = entry;
      const div = document.createElement("div");
      div.className = "admin-issue";

      const adminInfo = issue.adminReply ? `
        <div class="admin-reply">Reply: <div class="reply-text">${issue.adminReply}</div>
        <div class="reply-meta">By ${issue.adminReplyBy || "admin"} at ${issue.adminReplyAt ? new Date(issue.adminReplyAt).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ""}</div>
        </div>` : "";

      div.innerHTML = `
        <div class="admin-issue-header">
          <strong class="issue-title">${issue.title}</strong>
          <div class="issue-meta">by <b>${issue.teamName || "anonymous"}</b> — <time>${new Date(issue.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
          <input type="checkbox" class="issue-resolved-toggle" title="Mark resolved" ${issue.status==='resolved'?'checked':''} onclick="event.stopPropagation(); updateIssueStatus('${id}', this.checked ? 'resolved' : 'open')">
        </div>
        <div class="issue-body">${issue.description}</div>
        <div class="issue-controls">
          <label>Status:</label>
          <select class="issue-status-select" onchange="updateIssueStatus('${id}',this.value)">
            <option value="open"${issue.status==="open"?" selected":""}>Open</option>
            <option value="fixed"${issue.status==="fixed"?" selected":""}>Fixed</option>
            <option value="intentional"${issue.status==="intentional"?" selected":""}>Intentional</option>
            <option value="resolved"${issue.status==="resolved"?" selected":""}>Resolved</option>
          </select>
        </div>
        <div class="issue-admin-reply">
          <textarea rows="3" placeholder="Reply to reporter...">${issue.adminReply||""}</textarea>
          <button class="btn btn-sm" onclick="replyToIssue('${id}', this.previousElementSibling.value, this)">Send Reply</button>
          <span class="reply-sent">Sent</span>
        </div>
        ${adminInfo}
      `;

      list.appendChild(div);
    };

    // active first
    active.forEach(appendIssue);

    // then resolved category
    if (resolved.length > 0) {
      const header = document.createElement('h4');
      header.textContent = 'Resolved Issues';
      header.style.marginTop = '12px';
      list.appendChild(header);
      resolved.forEach(appendIssue);
    }

  }, (err) => {
    console.error('Admin issues listener error:', err);
    list.innerHTML = '<p class="no-items">Unable to load admin issues.</p>';
  });
}

function updateIssueStatus(issueId, status) {
  const updates = {
    status,
    adminUpdatedAt: Date.now(),
    adminUpdatedBy: "admin"
  };
  if (status === 'resolved') {
    updates.resolvedAt = Date.now();
    updates.resolvedBy = 'admin';
  }
  db.collection("issues").doc(issueId).update(updates).catch((err) => console.error("Error updating issue status:", err));
}

function replyToIssue(issueId, reply, btnEl = null) {
  db.collection("issues").doc(issueId).update({
    adminReply: reply,
    adminReplyAt: Date.now(),
    adminReplyBy: "admin"
  }).then(() => {
    if (btnEl && btnEl.previousElementSibling) {
      btnEl.previousElementSibling.value = '';
    }
    // show 'Sent' briefly
    if (btnEl) {
      const sentEl = btnEl.parentElement.querySelector('.reply-sent');
      if (sentEl) {
        sentEl.classList.remove('failed');
        sentEl.classList.add('show');
        setTimeout(() => sentEl.classList.remove('show'), 2000);
      }
    }
  }).catch((err) => {
    console.error("Error sending reply:", err);
    if (btnEl) {
      const sentEl = btnEl.parentElement.querySelector('.reply-sent');
      if (sentEl) {
        sentEl.textContent = 'Failed';
        sentEl.classList.add('failed','show');
        setTimeout(() => {
          sentEl.classList.remove('failed','show');
          sentEl.textContent = 'Sent';
        }, 2000);
      }
    }
  });
}

// --- Rules editor support ---
async function loadRules() {
  try {
    const doc = await db.collection('site').doc('rules').get();
    const data = doc.exists ? doc.data() : { markdown: '' };
    const editor = document.getElementById('rulesEditor');
    if (editor) editor.value = data.markdown || '';
    renderRulesPreview(data.markdown || '');

    const meta = document.getElementById('rulesMeta');
    if (meta) {
      if (doc.exists && data.adminUpdatedAt) {
        const dt = data.adminUpdatedAt.toDate ? data.adminUpdatedAt.toDate() : new Date();
        meta.textContent = `Last updated ${dt.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} by ${data.adminUpdatedBy || 'admin'}`;
      } else {
        meta.textContent = 'Not yet saved.';
      }
    }
  } catch (err) {
    console.error('Error loading rules:', err);
    showAdminError('Failed to load rules');
  }
}

async function saveRules() {
  try {
    const editor = document.getElementById('rulesEditor');
    const data = {
      markdown: editor ? editor.value : '',
      adminUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      adminUpdatedBy: 'admin (password)'
    };
    await db.collection('site').doc('rules').set(data, { merge: true });
    showAdminMessage('Rules saved');
    // reload to show server timestamp
    setTimeout(loadRules, 500);
  } catch (err) {
    console.error('Error saving rules:', err);
    showAdminError('Failed to save rules');
  }
}

function renderRulesPreview(md) {
  // Use marked to parse markdown with GFM and single-line breaks enabled if available
  let rawHtml = md || '';
  if (window.marked) {
    // prefer marked.parse but fallback to marked(fn)
    const parser = typeof marked.parse === 'function' ? marked.parse : marked;
    try {
      rawHtml = parser(md || '', {
        gfm: true,
        breaks: true, // preserve single newlines
        smartLists: true,
        smartypants: true
      });
    } catch (e) {
      // fallback parse without options
      rawHtml = parser(md || '');
    }
  }

  // sanitize but allow common formatting plus <u> for underline
  const allowedTags = [
    'b','i','em','strong','a','p','ul','ol','li','br',
    'h1','h2','h3','h4','h5','h6','code','pre','u','blockquote'
  ];
  const allowedAttrs = ['href','target','rel','title'];

  const clean = window.DOMPurify
    ? DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: allowedAttrs })
    : rawHtml;

  const preview = document.getElementById('rulesPreview');
  if (!preview) return;

  preview.innerHTML = clean;

  // Ensure links open safely in a new tab
  preview.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
}

function setupRulesEditor() {
  const editor = document.getElementById('rulesEditor');
  if (!editor) return;

  // Configure marked globally if available
  if (window.marked && typeof marked.setOptions === 'function') {
    marked.setOptions({ gfm: true, breaks: true, smartLists: true, smartypants: true });
  }

  // debounce preview updates
  let t = null;
  editor.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => renderRulesPreview(editor.value), 200);
  });

  // initial render
  renderRulesPreview(editor.value || '');
}

// Bind UI elements on DOM ready (handle already-fired DOMContentLoaded)
function bindAdminUI() {
  const loginBtn = document.getElementById('admin-login-btn');
  if (loginBtn) loginBtn.addEventListener('click', adminLogin);

  const saveBtn = document.getElementById('saveRulesBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveRules);

  const revertBtn = document.getElementById('revertRulesBtn');
  if (revertBtn) revertBtn.addEventListener('click', loadRules);

  setupRulesEditor();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindAdminUI);
} else {
  bindAdminUI();
}
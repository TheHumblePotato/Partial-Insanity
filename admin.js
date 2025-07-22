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
      maxIterations: 200,
      defaultSpringLength: 120,
      defaultElectricalCharge: 150,
    }),
    "toolManager.hoverDelay": 500,
  });

  diagram.groupTemplate = $(
    go.Group,
    "Vertical",
    {
      selectionChanged: function (group) {},
      ungroupable: true,
      layout: $(go.GridLayout, { wrappingColumn: 1 }),
      click: function (e, group) {
        editRoom(group.data.key);
      },
    },
    $(
      go.TextBlock,
      { font: "bold 12pt sans-serif", editable: true },
      new go.Binding("text", "name"),
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        fill: "transparent",
        stroke: "#D2691E",
        strokeWidth: 3,
      }),
      $(go.Placeholder, { padding: 10 }),
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
        width: 100,
        height: 60,
        strokeWidth: 2,
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
    ),
    $(
      go.TextBlock,
      {
        margin: 5,
        font: "10px sans-serif",
        wrap: go.TextBlock.WrapFit,
        textAlign: "center",
      },
      new go.Binding("text", "name"),
    ),
  );

  diagram.linkTemplate = $(
    go.Link,
    { routing: go.Link.AvoidsNodes, curve: go.Link.JumpOver },
    $(go.Shape, { stroke: "#333", strokeWidth: 2 }),
    $(go.Shape, { toArrow: "Standard", fill: "#333", stroke: null }),
  );

  loadDiagramData();
}

function addAnswer() {
  const container = document.getElementById("answersContainer");
  const div = document.createElement("div");
  div.className = "answer-entry";
  div.innerHTML = `
    <input type="text" class="answer-input" placeholder="Answer" />
    <button class="btn btn-sm btn-danger" onclick="removeAnswer(this)">×</button>
  `;
  container.appendChild(div);
}

function removeAnswer(btn) {
  btn.closest(".answer-entry").remove();
}

function addImageUrl() {
  const container = document.getElementById("imagesField");
  const div = document.createElement("div");
  div.className = "image-url-entry";
  div.innerHTML = `
    <input type="text" class="image-url" placeholder="https://example.com/image.jpg" />
    <button class="btn btn-sm btn-danger" onclick="removeImageUrl(this)">×</button>
  `;
  container.appendChild(div);
}

function removeImageUrl(btn) {
  btn.closest(".image-url-entry").remove();
}

function updateMediaFields() {
  const type = document.getElementById("mediaType").value;
  document
    .getElementById("pdfField")
    .classList.toggle("hidden", type !== "pdf");
  document
    .getElementById("imagesField")
    .classList.toggle("hidden", type !== "images");
}

// Simple reversible encoding (not secure, just obfuscates)
function encodeAnswer(answer) {
  return btoa(unescape(encodeURIComponent(answer)));
}

function decodeAnswer(encoded) {
  try {
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return encoded; // fallback if not encoded
  }
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

    diagram.model = new go.GraphLinksModel({
      nodeCategoryProperty: "category",
      nodeDataArray: [...groups, ...nodes],
      linkDataArray: links,
    });
    Object.entries(roomData).forEach(([roomId, room]) => {
      if (room.clearUnlock && room.clearUnlock.type === "room") {
        links.push({
          from: roomId,
          to: room.clearUnlock.id,
          category: "roomUnlock",
        });
      }
    });

    diagram.linkTemplateMap.add(
      "roomUnlock",
      $(
        go.Link,
        { routing: go.Link.AvoidsNodes, curve: go.Link.JumpOver },
        $(go.Shape, {
          stroke: "#4CAF50",
          strokeWidth: 3,
          strokeDashArray: [5, 5],
        }),
        $(go.Shape, { toArrow: "Standard", fill: "#4CAF50", stroke: null }),
      ),
    );

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
  } catch (error) {
    console.error("Error loading diagram data:", error);
  }
}
// Puzzle Editor Functions
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
                      }</li>`,
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
      maxIterations: 200,
      defaultSpringLength: 120,
      defaultElectricalCharge: 150,
    }),
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
      { font: "bold 12pt sans-serif" },
      new go.Binding("text", "name"),
    ),
    $(
      go.Panel,
      "Auto",
      $(go.Shape, "Rectangle", {
        stroke: "#D269E1",
        strokeWidth: 3,
      }).bind("fill", "", function (data) {
        if ((selectedTeam.progress.clearedRooms || []).includes(data.key))
          return "#90EE90";
        if ((selectedTeam.progress.unlockedRooms || []).includes(data.key))
          return "#FFFF99";
        return "#FF9999";
      }),
      $(go.Placeholder, { padding: 10 }),
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
      mouseEnter: function (e, node) {
        if (!node.containingGroup && !teamDiagram.findNodeForKey("ungrouped")) {
          teamDiagram.model.addNodeData({
            key: "ungrouped",
            isGroup: true,
            name: "Ungrouped Puzzles",
            category: "room",
          });
        }
        if (!node.containingGroup) {
          teamDiagram.model.setGroupKeyForNodeData(node.data, "ungrouped");
        }
      },
    },
    $(go.Shape, "Rectangle", {
      width: 100,
      height: 60,
      strokeWidth: 2,
      stroke: "#333",
    }).bind("fill", "", function (data) {
      if ((selectedTeam.progress.solvedPuzzles || []).includes(data.key))
        return "#90EE90";
      if (isPuzzleUnlocked(data.key)) return "#FFFF99";
      return "#FF9999";
    }),
    $(
      go.TextBlock,
      {
        margin: 5,
        font: "10px sans-serif",
        wrap: go.TextBlock.WrapFit,
        textAlign: "center",
      },
      new go.Binding("text", "name"),
    ),
  );

  const nodes = [];
  const groups = [];
  const links = [];

  // Create a default group for ungrouped puzzles
  groups.push({
    key: "ungrouped",
    isGroup: true,
    name: "Ungrouped Puzzles",
    category: "room",
  });

  Object.entries(roomData).forEach(([id, room]) => {
    groups.push({
      key: id,
      isGroup: true,
      name: room.name || id,
      category: "room",
    });
  });

  Object.entries(puzzleData).forEach(([id, puzzle]) => {
    nodes.push({
      key: id,
      name: puzzle.name || id,
      group: puzzle.room || "ungrouped", // Default to ungrouped
      category: "puzzle",
    });

    if (puzzle.unlocks) links.push({ from: id, to: puzzle.unlocks });
    if (puzzle.followup) links.push({ from: id, to: puzzle.followup });
  });

  teamDiagram.model = new go.GraphLinksModel({
    nodeDataArray: [...groups, ...nodes],
    linkDataArray: links,
    nodeCategoryProperty: "category",
  });
  teamDiagram.layoutDiagram(true);
}

function isPuzzleUnlocked(puzzleId) {
  const puzzle = puzzleData[puzzleId];

  // Always show puzzles that aren't in any room
  if (!puzzle.room) return true;

  // Existing room check logic
  const roomId = puzzle.room;
  if (
    (selectedTeam.progress.unlockedRooms || []).includes(roomId) ||
    (selectedTeam.progress.clearedRooms || []).includes(roomId)
  ) {
    return true;
  }

  // Followup check
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
    // Update local progress
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
    // Update the diagram bindings
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
      const updates = {
        solvedPuzzles: firebase.firestore.FieldValue.arrayUnion(puzzleId),
      };

      // Handle solve-linked puzzles
      const puzzle = puzzleData[puzzleId];
      if (puzzle.solveLinks) {
        updates.solvedPuzzles = firebase.firestore.FieldValue.arrayUnion(
          ...puzzle.solveLinks.filter(
            (pId) => !selectedTeam.progress.solvedPuzzles?.includes(pId),
          ),
        );
      }

      await teamRef.update(updates);
      selectedTeam.progress.solvedPuzzles = [
        ...new Set([
          ...(selectedTeam.progress.solvedPuzzles || []),
          puzzleId,
          ...(puzzle.solveLinks || []),
        ]),
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

  const answersContainer = document.getElementById("answersContainer");
  answersContainer.innerHTML = "";
  if (puzzle.answers && puzzle.answers.length > 0) {
    puzzle.answers.forEach((answer) => {
      const decoded = decodeAnswer(answer);
      const div = document.createElement("div");
      div.className = "answer-entry";
      div.innerHTML = `
        <input type="text" class="answer-input" value="${decoded}" />
        <button class="btn btn-sm btn-danger" onclick="removeAnswer(this)">×</button>
      `;
      answersContainer.appendChild(div);
    });
  } else {
    addAnswer();
  }

  // Update media handling
  if (puzzle.images && puzzle.images.length > 0) {
    document.getElementById("mediaType").value = "images";
    const imagesField = document.getElementById("imagesField");
    imagesField.innerHTML = "";
    puzzle.images.forEach((url) => {
      const div = document.createElement("div");
      div.className = "image-url-entry";
      div.innerHTML = `
        <input type="text" class="image-url" value="${url}" />
        <button class="btn btn-sm btn-danger" onclick="removeImageUrl(this)">×</button>
      `;
      imagesField.appendChild(div);
    });
    addImageUrl();
    updateMediaFields();
  } else if (puzzle.pdf) {
    document.getElementById("mediaType").value = "pdf";
    document.getElementById("puzzlePdf").value = puzzle.pdf;
    updateMediaFields();
  }

  // Populate solve-linked puzzles
  const solveLinksSelect = document.getElementById("puzzleSolveLinks");
  solveLinksSelect.innerHTML = "";
  Object.keys(puzzleData).forEach((pId) => {
    if (pId !== puzzleId) {
      const option = document.createElement("option");
      option.value = pId;
      option.textContent = puzzleData[pId].name || pId;
      solveLinksSelect.appendChild(option);
    }
  });
  if (puzzle.solveLinks) {
    puzzle.solveLinks.forEach((pId) => {
      const option = solveLinksSelect.querySelector(`option[value="${pId}"]`);
      if (option) option.selected = true;
    });
  }

  document.getElementById("puzzleMaxGuesses").value = puzzle.maxGuesses || 3;
  document.getElementById("puzzleRequiredCorrect").value =
    puzzle.requiredCorrect || 1;
  document.getElementById("puzzleDescription").value = puzzle.description || "";
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

  // Then create the puzzle object
  const puzzle = {
    name: puzzleName,
    type: type,
    hasAnswer: hasAnswer,
    hints: hints, // Now this references the already-defined hints array
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
    const answers = [];
    document.querySelectorAll(".answer-input").forEach((input) => {
      const answer = input.value.trim();
      if (answer) answers.push(encodeAnswer(answer));
    });
    puzzle.answers = answers;

    puzzle.requiredCorrect =
      parseInt(document.getElementById("puzzleRequiredCorrect").value) || 1;
    puzzle.maxGuesses =
      parseInt(document.getElementById("puzzleMaxGuesses").value) || 0;
  }

  // Handle media
  const mediaType = document.getElementById("mediaType").value;
  if (mediaType === "pdf") {
    puzzle.pdf = document.getElementById("puzzlePdf").value.trim();
    puzzle.images = undefined;
  } else {
    const images = [];
    document.querySelectorAll(".image-url").forEach((input) => {
      const url = input.value.trim();
      if (url) images.push(url);
    });
    if (images.length > 0) {
      puzzle.images = images;
      puzzle.pdf = undefined;
    }
  }

  // Handle solve-linked puzzles
  const solveLinksSelect = document.getElementById("puzzleSolveLinks");
  puzzle.solveLinks = Array.from(solveLinksSelect.selectedOptions).map(
    (option) => option.value,
  );

  puzzle.maxGuesses =
    parseInt(document.getElementById("puzzleMaxGuesses").value) || 0;

  if (type === "lock") {
    puzzle.requiredCorrect =
      parseInt(document.getElementById("puzzleRequiredCorrect").value) || 1;
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
    alert("Puzzle deleted successfully!");
  } catch (error) {
    console.error("Error deleting puzzle:", error);
    alert("Error deleting puzzle: " + error.message);
  }
}

function showRoomEditor(roomId = null) {
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

  // Set selected values if editing
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

  // Add rooms
  select.innerHTML += '<optgroup label="Rooms">';
  Object.keys(roomData).forEach((roomId) => {
    if (roomId !== currentEditingRoom) {
      select.innerHTML += `<option value="room:${roomId}">Room: ${
        roomData[roomId].name || roomId
      }</option>`;
    }
  });

  // Add puzzles
  select.innerHTML += '<optgroup label="Puzzles">';
  Object.keys(puzzleData).forEach((puzzleId) => {
    select.innerHTML += `<option value="puzzle:${puzzleId}">Puzzle: ${
      puzzleData[puzzleId].name || puzzleId
    }</option>`;
  });

  // Set selected value if editing
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

  // Handle clear unlock
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
      "Are you sure you want to reset the diagram layout? This will remove all custom positions.",
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

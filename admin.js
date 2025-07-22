const firebaseConfig = {
  apiKey: "AIzaSyAjp9_6nVxqUVneYVXd5m2hsD4ayJbwaLg",
  authDomain: "partial-insanity.firebaseapp.com",
  projectId: "partial-insanity",
  storageBucket: "partial-insanity.firebasestorage.app",
  messagingSenderId: "746340494144",
  appId: "1:746340494144:web:86b5be3e2f5dfd2e92a8a5",
  measurementId: "G-3Q11XF589Q",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebase.database();

const SECURITY_SALT = "partial-insanity-2025-salt";
let currentUser = null;
let rooms = {};
let puzzles = {};
let teams = {};
let network = null;
let nodes = null;
let edges = null;
let selectedNode = null;
let connectionFrom = null;
console.log('Eliana was here');


// Initialize the page
function init() {
  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      if (user.email === "yiyangl30@lakesideschool.org") {
        loadData();
        setupNetwork();
      } else {
        alert("You don't have admin access");
        window.location.href = "index.html";
      }
    } else {
      window.location.href = "index.html";
    }
  });
}

// Load all data from Firestore
async function loadData() {
  try {
    // Load rooms
    const roomsSnapshot = await db.collection("rooms").doc("config").get();
    rooms = roomsSnapshot.exists ? roomsSnapshot.data() : {};

    // Load puzzles
    const puzzlesSnapshot = await db.collection("puzzles").doc("config").get();
    puzzles = puzzlesSnapshot.exists ? puzzlesSnapshot.data() : {};

    // Load teams
    const teamsSnapshot = await db.collection("teams").get();
    teams = {};
    teamsSnapshot.forEach((doc) => {
      teams[doc.id] = doc.data();
    });

    // Load team progress
    const progressSnapshot = await db.collection("progress").get();
    progressSnapshot.forEach((doc) => {
      if (teams[doc.id]) {
        teams[doc.id].progress = doc.data();
      }
    });

    updateNetwork();
    updateTeamList();
  } catch (error) {
    console.error("Error loading data:", error);
    alert("Error loading data: " + error.message);
  }
}

// Set up the network visualization with hierarchical layout
function setupNetwork() {
  const container = document.getElementById("network");
  nodes = new vis.DataSet();
  edges = new vis.DataSet();

  const data = {
    nodes: nodes,
    edges: edges,
  };

  const options = {
    nodes: {
      shape: "box",
      font: {
        size: 12,
        face: "Arial",
      },
      borderWidth: 2,
      margin: 10,
      widthConstraint: {
        minimum: 100,
        maximum: 150
      }
    },
    edges: {
      width: 2,
      smooth: {
        type: "continuous",
      },
      arrows: {
        to: { enabled: true, scaleFactor: 0.5 },
      },
    },
    layout: {
      hierarchical: {
        direction: "UD",
        sortMethod: "directed",
        nodeSpacing: 150,
        levelSeparation: 150
      }
    },
    physics: {
      hierarchicalRepulsion: {
        nodeDistance: 200,
        springLength: 200
      },
      solver: "hierarchicalRepulsion"
    },
    interaction: {
      dragNodes: true,
      dragView: true,
      zoomView: true,
      multiselect: false,
      navigationButtons: true,
      keyboard: true,
    },
  };

  network = new vis.Network(container, data, options);

  // Handle node selection
  network.on("selectNode", (params) => {
    selectedNode = params.nodes[0];
    
    if (connectionFrom) {
      createConnection(connectionFrom, selectedNode);
      connectionFrom = null;
      return;
    }
  });

  // Handle right-click
  network.on("oncontext", (params) => {
    params.event.preventDefault();
    selectedNode = params.nodes[0];
    
    if (selectedNode) {
      const node = nodes.get(selectedNode);
      if (node.group === "room") {
        openRoomModal(node.id);
      } else {
        openPuzzleModal(node.id);
      }
    }
  });

  // Handle click on background
  network.on("click", (params) => {
    if (params.nodes.length === 0) {
      selectedNode = null;
    }
  });
}

// Update the network with current data
function updateNetwork() {
  nodes.clear();
  edges.clear();

  // Add rooms as parent nodes
  for (const roomId in rooms) {
    const room = rooms[roomId];
    nodes.add({
      id: roomId,
      label: room.name,
      group: "room",
      shape: "ellipse",
      size: 50,
      color: {
        background: "#3498db",
        border: "#2980b9",
        highlight: {
          background: "#5dade2",
          border: "#3498db",
        },
      },
      level: 0
    });
  }

  // Add puzzles as child nodes inside their rooms
  for (const puzzleId in puzzles) {
    const puzzle = puzzles[puzzleId];
    if (puzzle.room && rooms[puzzle.room]) {
      nodes.add({
        id: puzzleId,
        label: puzzle.name,
        group: puzzle.type === "meta" ? "meta" : "puzzle",
        shape: "box",
        color: {
          background: puzzle.type === "meta" ? "#f39c12" : "#2ecc71",
          border: puzzle.type === "meta" ? "#e67e22" : "#27ae60",
          highlight: {
            background: puzzle.type === "meta" ? "#f5b041" : "#58d68d",
            border: puzzle.type === "meta" ? "#f39c12" : "#2ecc71",
          },
        },
        level: 1
      });

      // Connect puzzle to its room
      edges.add({
        from: puzzle.room,
        to: puzzleId,
        dashes: false,
        color: {
          color: "#95a5a6",
          highlight: "#bdc3c7",
        },
      });
    } else {
      // Free-floating puzzles (not in a room)
      nodes.add({
        id: puzzleId,
        label: puzzle.name,
        group: puzzle.type === "meta" ? "meta" : "puzzle",
        shape: "box",
        color: {
          background: puzzle.type === "meta" ? "#f39c12" : "#2ecc71",
          border: puzzle.type === "meta" ? "#e67e22" : "#27ae60",
          highlight: {
            background: puzzle.type === "meta" ? "#f5b041" : "#58d68d",
            border: puzzle.type === "meta" ? "#f39c12" : "#2ecc71",
          },
        },
        level: 0
      });
    }

    // Add connections for unlocks and follow-ups
    if (puzzle.unlocks && rooms[puzzle.unlocks]) {
      edges.add({
        from: puzzleId,
        to: puzzle.unlocks,
        arrows: "to",
        color: {
          color: "#3498db",
          highlight: "#2980b9",
        },
      });
    }

    if (puzzle.followup && puzzles[puzzle.followup]) {
      edges.add({
        from: puzzleId,
        to: puzzle.followup,
        arrows: "to",
        color: {
          color: "#9b59b6",
          highlight: "#8e44ad",
        },
      });
    }
  }
}

// Open room edit modal with clear conditions
function openRoomModal(roomId = null) {
  selectedNode = roomId;
  const modal = document.getElementById("room-modal");
  const room = roomId ? rooms[roomId] : { 
    name: "", 
    type: "normal",
    clearCondition: {
      type: "fullsolve",
      count: 1
    }
  };

  document.getElementById("room-name").value = room.name || "";
  document.getElementById("room-type").value = room.type || "normal";
  document.getElementById("room-background").value = room.background || "";
  document.getElementById("room-clear-type").value = room.clearCondition?.type || "fullsolve";
  document.getElementById("room-clear-count").value = room.clearCondition?.count || 1;

  // Show/hide fields based on room type
  toggleRoomFields();

  modal.style.display = "flex";
}

// Save room data with clear conditions
async function saveRoom() {
  const roomId = selectedNode || `room-${Date.now()}`;
  const roomName = document.getElementById("room-name").value.trim();
  const roomType = document.getElementById("room-type").value;
  const roomBackground = document.getElementById("room-background").value.trim();
  const clearType = document.getElementById("room-clear-type").value;
  const clearCount = parseInt(document.getElementById("room-clear-count").value) || 1;

  if (!roomName) {
    alert("Please enter a room name");
    return;
  }

  rooms[roomId] = {
    name: roomName,
    type: roomType,
    puzzles: rooms[roomId]?.puzzles || [],
    clearCondition: {
      type: clearType,
      count: clearCount
    }
  };

  if (roomType === "image" && roomBackground) {
    rooms[roomId].background = roomBackground;
  }

  closeModal("room-modal");
  updateNetwork();
}

// Open puzzle edit modal with lock support
function openPuzzleModal(puzzleId = null) {
  selectedNode = puzzleId;
  const modal = document.getElementById("puzzle-modal");
  const puzzle = puzzleId ? puzzles[puzzleId] : { 
    name: "", 
    room: "", 
    pdf: "", 
    hasAnswer: false, 
    answers: [], 
    maxGuesses: 0,
    type: "puzzle",
    description: "",
    requiredCorrect: 1
  };

  document.getElementById("puzzle-name").value = puzzle.name || "";
  document.getElementById("puzzle-room").value = puzzle.room || "";
  document.getElementById("puzzle-pdf").value = puzzle.pdf || "";
  document.getElementById("puzzle-has-answer").checked = puzzle.hasAnswer || false;
  document.getElementById("puzzle-answers").value = puzzle.answers ? puzzle.answers.join("\n") : "";
  document.getElementById("puzzle-max-guesses").value = puzzle.maxGuesses || 0;
  document.getElementById("puzzle-followup").value = puzzle.followup || "";
  document.getElementById("puzzle-unlocks").value = puzzle.unlocks || "";
  document.getElementById("puzzle-description").value = puzzle.description || "";
  document.getElementById("puzzle-required-correct").value = puzzle.requiredCorrect || 1;
  document.getElementById("puzzle-type").value = puzzle.type || "puzzle";

  // Update PDF preview
  updatePdfPreview(puzzle.pdf);

  // Toggle fields based on puzzle type
  togglePuzzleFields();

  // Populate room dropdown
  const roomSelect = document.getElementById("puzzle-room");
  roomSelect.innerHTML = '<option value="">None (free floating)</option>';
  for (const roomId in rooms) {
    const option = document.createElement("option");
    option.value = roomId;
    option.textContent = rooms[roomId].name;
    if (puzzle.room === roomId) {
      option.selected = true;
    }
    roomSelect.appendChild(option);
  }

  modal.style.display = "flex";
}

// Save puzzle data with lock support
async function savePuzzle() {
  const puzzleId = selectedNode || `puzzle-${Date.now()}`;
  const puzzleName = document.getElementById("puzzle-name").value.trim();
  const puzzleRoom = document.getElementById("puzzle-room").value;
  const puzzlePdf = document.getElementById("puzzle-pdf").value.trim();
  const puzzleHasAnswer = document.getElementById("puzzle-has-answer").checked;
  const puzzleAnswers = document.getElementById("puzzle-answers").value.split("\n").map(a => a.trim()).filter(a => a);
  const puzzleMaxGuesses = parseInt(document.getElementById("puzzle-max-guesses").value) || 0;
  const puzzleFollowup = document.getElementById("puzzle-followup").value.trim() || null;
  const puzzleUnlocks = document.getElementById("puzzle-unlocks").value.trim() || null;
  const puzzleDescription = document.getElementById("puzzle-description").value.trim();
  const puzzleRequiredCorrect = parseInt(document.getElementById("puzzle-required-correct").value) || 1;
  const puzzleType = document.getElementById("puzzle-type").value;

  if (!puzzleName) {
    alert("Please enter a puzzle name");
    return;
  }

  // Hash answers for security
  const hashedAnswers = puzzleAnswers.map(answer => hashAnswer(answer));

  puzzles[puzzleId] = {
    name: puzzleName,
    room: puzzleRoom,
    pdf: puzzlePdf,
    hasAnswer: puzzleHasAnswer,
    answers: hashedAnswers,
    maxGuesses: puzzleMaxGuesses,
    followup: puzzleFollowup,
    unlocks: puzzleUnlocks,
    type: puzzleType,
    description: puzzleDescription,
    requiredCorrect: puzzleRequiredCorrect
  };

  // Add to room's puzzle list if assigned to a room
  if (puzzleRoom && rooms[puzzleRoom] && !rooms[puzzleRoom].puzzles.includes(puzzleId)) {
    rooms[puzzleRoom].puzzles.push(puzzleId);
  }

  // Remove from old room if changed
  if (selectedNode && puzzles[selectedNode] && puzzles[selectedNode].room && puzzles[selectedNode].room !== puzzleRoom) {
    const oldRoom = puzzles[selectedNode].room;
    if (rooms[oldRoom]) {
      rooms[oldRoom].puzzles = rooms[oldRoom].puzzles.filter(id => id !== puzzleId);
    }
  }

  closeModal("puzzle-modal");
  updateNetwork();
}

// Toggle fields based on puzzle type
function togglePuzzleFields() {
  const puzzleType = document.getElementById("puzzle-type").value;
  const isLock = puzzleType === "lock";
  
  document.getElementById("pdf-group").style.display = isLock ? "none" : "block";
  document.getElementById("puzzle-description-group").style.display = isLock ? "block" : "none";
  document.getElementById("puzzle-required-correct-group").style.display = isLock ? "block" : "none";
}

// Toggle room fields based on room type
function toggleRoomFields() {
  const roomType = document.getElementById("room-type").value;
  document.getElementById("room-bg-group").style.display = roomType === "image" ? "block" : "none";
  
  const clearType = document.getElementById("room-clear-type").value;
  document.getElementById("room-clear-count-group").style.display = clearType === "partialsolve" ? "block" : "none";
}

// Hash answer for security
function hashAnswer(answer) {
  return CryptoJS.SHA256(answer.toString().toUpperCase() + SECURITY_SALT).toString();
}

// Initialize the app when the page loads
window.onload = init;
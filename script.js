const firebaseConfig = {
  apiKey: "AIzaSyAjp9_6nVxqUVneYVXd5m2hsD4ayJbwaLg",
  authDomain: "partial-insanity.firebaseapp.com",
  projectId: "partial-insanity",
  storageBucket: "partial-insanity.appspot.com",
  messagingSenderId: "746340494144",
  appId: "1:746340494144:web:86b5be3e2f5dfd2e92a8a5",
  measurementId: "G-3Q11XF589Q"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebase.database();

const SECURITY_SALT = "partial-insanity-2025-salt";
let currentUser = null;
let currentTeam = null;
let currentRoom = "starting_room";
let currentPuzzle = null;
let puzzleData = {};
let roomData = {};
let teamProgress = {};
let unlockedNewContent = {};

auth.onAuthStateChanged((user) => {
  if (user) {
    currentUser = user;
    loadTeamData();
  } else {
    currentUser = null;
    showAuthPage();
  }
});

function hashAnswer(answer) {
  return CryptoJS.SHA256(
    answer.toString().toUpperCase() + SECURITY_SALT,
  ).toString();
}

function checkAnswer(answer, hashedAnswers) {
  const hashedInput = hashAnswer(answer);
  return hashedAnswers.includes(hashedInput);
}

async function loadTeamData() {
  try {
    const teamDoc = await db.collection("teams").doc(currentUser.uid).get();
    if (teamDoc.exists) {
      currentTeam = teamDoc.data();
      document.getElementById("team-info").textContent = `Team: ${currentTeam.name}`;

      const progressDoc = await db.collection("progress").doc(currentUser.uid).get();
      if (progressDoc.exists) {
        teamProgress = progressDoc.data();

        // Initialize progress fields
        teamProgress.solvedPuzzles = teamProgress.solvedPuzzles || [];
        teamProgress.unlockedRooms = teamProgress.unlockedRooms || ["starting_room"];
        teamProgress.guessCount = teamProgress.guessCount || {};
        teamProgress.clearedRooms = teamProgress.clearedRooms || [];
        teamProgress.viewedUnlocks = teamProgress.viewedUnlocks || [];

        // Get the first uncleared room
        const unlockedRooms = teamProgress.unlockedRooms;
        const clearedRooms = teamProgress.clearedRooms;
        
        // Find first uncleared room
        let firstUncleared = unlockedRooms.find(roomId => !clearedRooms.includes(roomId));
        
        // If all rooms cleared, use last unlocked room
        if (!firstUncleared && unlockedRooms.length > 0) {
          firstUncleared = unlockedRooms[unlockedRooms.length - 1];
        }

        // Default to starting room if something went wrong
        currentRoom = firstUncleared || "starting_room";

        // Update current room if different from stored
        if (teamProgress.currentRoom !== currentRoom) {
          teamProgress.currentRoom = currentRoom;
          await db.collection("progress").doc(currentUser.uid).set(teamProgress);
        }

      } else {
        // Initialize new team progress
        teamProgress = {
          solvedPuzzles: [],
          currentRoom: "starting_room",
          unlockedRooms: ["starting_room"],
          guessCount: {},
          viewedUnlocks: [],
          clearedRooms: []
        };
        await db.collection("progress").doc(currentUser.uid).set(teamProgress);
      }

      await loadPuzzleData();
      showPuzzlePage();
    } else {
      logout();
    }
  } catch (error) {
    console.error("Error loading team data:", error);
    logout();
  }
}

function isRoomCleared(roomId) {
  const room = roomData[roomId];
  if (!room || !room.clearCondition) return false;
  
  const solvedPuzzles = teamProgress.solvedPuzzles || [];
  const roomPuzzles = room.puzzles || [];
  const clearCondition = room.clearCondition;

  // Handle both string (legacy) and object formats
  const conditionType = typeof clearCondition === 'string' 
    ? clearCondition 
    : clearCondition.type;

  switch(conditionType) {
    case "fullsolve":
      return roomPuzzles.every(puzzleId => solvedPuzzles.includes(puzzleId));

    case "partialsolve": {
      const requiredCount = typeof clearCondition === 'object' 
        ? (clearCondition.count || 1)
        : (room.clearCount || 1);
      return roomPuzzles.filter(puzzleId => solvedPuzzles.includes(puzzleId)).length >= requiredCount;
    }

    case "meta": {
      const metaPuzzles = roomPuzzles.filter(puzzleId => 
        puzzleData[puzzleId]?.type === "meta"
      );
      return metaPuzzles.every(puzzleId => solvedPuzzles.includes(puzzleId));
    }

    case "lock": {
      const lockPuzzles = roomPuzzles.filter(puzzleId => 
        puzzleData[puzzleId]?.type === "lock"
      );
      return lockPuzzles.every(puzzleId => solvedPuzzles.includes(puzzleId));
    }

    case "mustsolve": {
      const mustSolvePuzzles = typeof clearCondition === 'object'
        ? (clearCondition.puzzles || [])
        : (room.mustSolvePuzzles || []);
      return mustSolvePuzzles.every(puzzleId => solvedPuzzles.includes(puzzleId));
    }

    default:
      return false;
  }
}


async function loadPuzzleData() {
  try {
    const roomDoc = await db.collection("rooms").doc("config").get();
    const puzzleDoc = await db.collection("puzzles").doc("config").get();

    if (!roomDoc.exists || !puzzleDoc.exists) {
      await loadPuzzleData();
      return;
    }

    roomData = roomDoc.data();
    puzzleData = puzzleDoc.data();

    checkForNewlyUnlockedContent();

    renderCurrentRoom();
  } catch (error) {
    console.error("Error loading puzzle data:", error);
  }
}

function checkForNewlyUnlockedContent() {
  unlockedNewContent = {};

  const unlockedRooms = teamProgress.unlockedRooms || ["starting_room"];
  
  // Check puzzle-based unlocks
  Object.keys(puzzleData).forEach(puzzleId => {
    const puzzle = puzzleData[puzzleId];
    if (puzzle.unlocks && 
        teamProgress.solvedPuzzles.includes(puzzleId) &&
        !teamProgress.viewedUnlocks?.includes(puzzle.unlocks)) {
      unlockedNewContent[puzzle.unlocks] = puzzleId;
    }
  });

  // Check room clear-based unlocks
  teamProgress.clearedRooms.forEach(roomId => {
    const room = roomData[roomId];
    if (room.clearUnlock) {
      const unlockType = room.clearUnlock?.type || '';
      const unlockId = room.clearUnlock?.id || '';
      if (unlockType === 'room' && 
          !teamProgress.viewedUnlocks?.includes(unlockId) &&
          !teamProgress.unlockedRooms.includes(unlockId)) {
        unlockedNewContent[unlockId] = roomId;
      }
    }
  });
}

function showNotification(message, type = 'info', duration = 3000) {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <span class="notification-message">${message}</span>
      <button class="notification-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after duration
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, duration);
}

function showSolveMessage(puzzleId) {
  const puzzle = puzzleData[puzzleId];
  if (puzzle && puzzle.solveMessage) {
    showSolveMessageModal(puzzle.solveMessage);
  }
}

function showSolveMessageModal(message) {
  const modal = document.getElementById('solve-message-modal');
  const messageContent = document.getElementById('solve-message-content');
  messageContent.textContent = message;
  modal.style.display = 'block';
}

function closeSolveMessageModal() {
  document.getElementById('solve-message-modal').style.display = 'none';
}

function showAuthPage() {
  document.getElementById("auth-page").style.display = "block";
  document.getElementById("puzzle-page").style.display = "none";
  document.getElementById("rules-page").style.display = "none";
}

function showPuzzlePage() {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("puzzle-page").style.display = "block";
  document.getElementById("rules-page").style.display = "none";
  renderCurrentRoom();
}

function showRulesPage() {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("puzzle-page").style.display = "none";
  document.getElementById("rules-page").style.display = "block";
}

function showRegisterForm() {
  document.getElementById("login-form").classList.add("hidden");
  document.getElementById("register-form").classList.remove("hidden");
  document.getElementById("forgot-key-form").classList.add("hidden");
}

function showLoginForm() {
  document.getElementById("register-form").classList.add("hidden");
  document.getElementById("login-form").classList.remove("hidden");
  document.getElementById("forgot-key-form").classList.add("hidden");
  document.getElementById("reset-message").classList.add("hidden");
}

function showForgotKeyForm() {
  document.getElementById("login-form").classList.add("hidden");
  document.getElementById("register-form").classList.add("hidden");
  document.getElementById("forgot-key-form").classList.remove("hidden");
}

async function registerTeam() {
  const teamName = document.getElementById("new-team-name").value.trim();
  const email = document.getElementById("team-email").value.trim();
  const password = document
    .getElementById("team-password-register")
    .value.trim();

  if (!teamName || !email || !password) {
    showNotification("Please fill in all fields", "error");
    return;
  }

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(
      email,
      password,
    );
    const user = userCredential.user;

    await db.collection("teams").doc(user.uid).set({
      name: teamName,
      email: email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    await db
      .collection("progress")
      .doc(user.uid)
      .set({
        startTime: Date.now(), 
        solvedPuzzles: [],
        currentRoom: "starting_room",
        unlockedRooms: ["starting_room"],
        guessCount: {},
        viewedUnlocks: [],
        clearedRooms: []
      });

    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.error("Error creating team:", error);
    showNotification("Error creating team: " + error.message, "error");
  }
}

async function loginTeam() {
  const teamName = document.getElementById("team-name").value.trim();
  const password = document.getElementById("team-password").value.trim();

  if (!teamName || !password) {
    showNotification("Please enter both team name and password", "error");
    return;
  }

  try {
    const teamsQuery = await db
      .collection("teams")
      .where("name", "==", teamName)
      .get();

    if (teamsQuery.empty) {
      showNotification("Team not found", "error");
      return;
    }

    const teamDoc = teamsQuery.docs[0];
    const teamData = teamDoc.data();

    await auth.signInWithEmailAndPassword(teamData.email, password);
  } catch (error) {
    console.error("Error logging in:", error);
    showNotification("Error logging in: " + error.message, "error");
  }
}

async function recoverPassword() {
  const teamName = document.getElementById("recover-team-name").value.trim();
  const email = document.getElementById("recover-team-email").value.trim();

  if (!teamName || !email) {
    showNotification("Please fill in all fields", "error");
    return;
  }

  try {
    const teamsQuery = await db
      .collection("teams")
      .where("name", "==", teamName)
      .where("email", "==", email)
      .get();

    if (teamsQuery.empty) {
      showNotification("No team found with that name and email", "error");
      return;
    }

    const teamDoc = teamsQuery.docs[0];
    const teamData = teamDoc.data();

    await auth.sendPasswordResetEmail(teamData.email);

    const resetMessage = document.getElementById("reset-message");
    resetMessage.textContent =
      "Password reset email sent. Please check your inbox.";
    resetMessage.classList.remove("hidden");
  } catch (error) {
    console.error("Error recovering password:", error);
    showNotification("Error recovering password: " + error.message, "error");
  }
}

function logout() {
  auth.signOut();
}

function generateRandomPassword() {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function renderCurrentRoom() {
  if (!roomData[currentRoom]) return;

  const room = roomData[currentRoom];
  document.getElementById("current-room-title").textContent = room.name;
  document.getElementById("room-description").textContent = room.description || "";

  const navGroup = document.querySelector("#room-nav-buttons .room-nav-group");
  navGroup.innerHTML = "";

  if (currentRoom === "starting_room") {
    const rulesBtn = document.createElement("button");
    rulesBtn.className = "nav-btn";
    rulesBtn.textContent = "Rules";
    rulesBtn.onclick = showRulesPage;
    navGroup.appendChild(rulesBtn);
  }

  const clearedRooms = teamProgress.clearedRooms || [];
  const unlockedRooms = teamProgress.unlockedRooms || ["starting_room"];
  
  // Add uncleared rooms
  unlockedRooms
    .filter(roomId => !clearedRooms.includes(roomId))
    .forEach(roomId => {
        const btn = createRoomButton(roomId);
        navGroup.appendChild(btn);
    });

  // Add cleared rooms dropdown
  const dropdown = document.querySelector(".cleared-rooms-dropdown .dropdown-content");
  dropdown.innerHTML = clearedRooms
    .map(roomId => {
        const room = roomData[roomId];
        return `<button onclick="switchRoom('${roomId}')">${room?.name || roomId}</button>`;
    })
    .join("");

  if (room.type === "normal") {
    renderNormalRoom(room);
  } else if (room.type === "image") {
    renderImageRoom(room);
  }
}

function normalizeAnswer(answer) {
    if (typeof answer !== 'string') {
        answer = String(answer);
    }
    return answer.toLowerCase()
        .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
        .trim();
}

function createRoomButton(roomId) {
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.textContent = roomData[roomId]?.name || roomId;
    if (roomId === currentRoom) {
        btn.disabled = true;
        btn.style.opacity = "0.7";
    } else {
        btn.onclick = () => switchRoom(roomId);
    }
    return btn;
}

function renderNormalRoom(room) {
  document.getElementById("normal-room").style.display = "grid";
  document.getElementById("image-room").style.display = "none";

  const container = document.getElementById("normal-room");
  container.innerHTML = "";

  // Add original room puzzles
  room.puzzles.forEach((puzzleId) => {
    const puzzle = puzzleData[puzzleId];
    if (!puzzle) return;

    const puzzleElement = createPuzzleElement(puzzle, puzzleId);
    container.appendChild(puzzleElement);

    // Recursively add all follow-up puzzles in the same room
    addFollowupPuzzles(puzzleId, container);
  });

  // Add newly unlocked puzzles to the same room
  Object.entries(unlockedNewContent).forEach(([unlockId, puzzleId]) => {
    if (!room.puzzles.includes(unlockId) && puzzleData[unlockId] && !roomData[unlockId]) {
      const puzzle = puzzleData[unlockId];
      const puzzleElement = createPuzzleElement(puzzle, unlockId);
      container.appendChild(puzzleElement);
      
      // Also add any follow-ups for newly unlocked puzzles
      addFollowupPuzzles(unlockId, container);
    }
  });
}

function addFollowupPuzzles(puzzleId, container) {
  const solvedPuzzles = teamProgress.solvedPuzzles || [];
  const puzzle = puzzleData[puzzleId];
  
  if (puzzle && puzzle.followup && solvedPuzzles.includes(puzzleId)) {
    const followupPuzzle = puzzleData[puzzle.followup];
    if (followupPuzzle) {
      const followupElement = createPuzzleElement(followupPuzzle, puzzle.followup);
      followupElement.classList.add('followup-puzzle');
      container.appendChild(followupElement);
      
      // Recursively check for more follow-ups
      addFollowupPuzzles(puzzle.followup, container);
    }
  }
}

function renderImageRoom(room) {
  document.getElementById("normal-room").style.display = "none";
  document.getElementById("image-room").style.display = "block";

  const container = document.getElementById("image-room");
  container.innerHTML = "";
  container.style.backgroundImage = `url(${room.background})`;

  room.puzzles.forEach((puzzleId) => {
    const puzzle = puzzleData[puzzleId];
    if (!puzzle) return;

    const puzzleElement = createFloatingPuzzleElement(puzzle, puzzleId);
    container.appendChild(puzzleElement);

    // Recursively add all follow-up puzzles in the same room
    addFloatingFollowupPuzzles(puzzleId, container);
  });

  // Add newly unlocked puzzles to the same room
  Object.entries(unlockedNewContent).forEach(([unlockId, puzzleId]) => {
    if (!room.puzzles.includes(unlockId) && puzzleData[unlockId] && !roomData[unlockId]) {
      const puzzle = puzzleData[unlockId];
      const puzzleElement = createFloatingPuzzleElement(puzzle, unlockId);
      container.appendChild(puzzleElement);
      
      // Also add any follow-ups for newly unlocked puzzles
      addFloatingFollowupPuzzles(unlockId, container);
    }
  });
}

function addFloatingFollowupPuzzles(puzzleId, container) {
  const solvedPuzzles = teamProgress.solvedPuzzles || [];
  const puzzle = puzzleData[puzzleId];
  
  if (puzzle && puzzle.followup && solvedPuzzles.includes(puzzleId)) {
    const followupPuzzle = puzzleData[puzzle.followup];
    if (followupPuzzle) {
      const followupElement = createFloatingPuzzleElement(followupPuzzle, puzzle.followup);
      followupElement.classList.add('followup-puzzle');
      // Position followup near the original puzzle
      const parentElement = container.querySelector(`[onclick="openPuzzle('${puzzleId}')"]`);
      if (parentElement) {
        const parentLeft = parseInt(parentElement.style.left) || 100;
        const parentTop = parseInt(parentElement.style.top) || 100;
        followupElement.style.left = (parentLeft + 20) + "px";
        followupElement.style.top = (parentTop + 20) + "px";
      }
      container.appendChild(followupElement);
      
      // Recursively check for more follow-ups
      addFloatingFollowupPuzzles(puzzle.followup, container);
    }
  }
}

function createPuzzleElement(puzzle, puzzleId) {
  const element = document.createElement("div");
  element.className = "puzzle-item";

  const solved = (teamProgress.solvedPuzzles || []).includes(puzzleId);
  if (solved) {
    element.classList.add("solved");
  }

  element.onclick = () => openPuzzle(puzzleId);

  // Use the lock PDF for all locks
  const pdfUrl = puzzle.type === "lock" 
    ? "https://cdn.glitch.global/316e5bad-dde2-4c91-86f7-fc36f9e2d9b9/Lock.pdf?v=1748885916342"
    : puzzle.pdf;

  element.innerHTML = `
    <div class="puzzle-preview">
      ${pdfUrl ? `<iframe src="${pdfUrl}" width="100%" height="200px" style="border: none; pointer-events: none;"></iframe>` : puzzle.type === "lock" ? puzzle.description : "Puzzle"}
    </div>
    <div class="puzzle-title">${puzzle.name}</div>
    <div class="puzzle-type">${puzzle.type.toUpperCase()}</div>
  `;

  return element;
}


function createFloatingPuzzleElement(puzzle, puzzleId) {
  const element = document.createElement("div");
  element.className = "floating-puzzle";

  const container = document.getElementById("image-room");
  const containerWidth = container.offsetWidth;
  const containerHeight = container.offsetHeight;
  
  element.style.left = (puzzle.position.x / 1000 * containerWidth) + "px";
  element.style.top = (puzzle.position.y / 1000 * containerHeight) + "px";
  element.style.transform = `rotate(${puzzle.position.rotation}deg)`;
  element.style.width = "150px";
  element.style.height = "100px";

  element.style.transform = `rotate(${puzzle.position.rotation}deg)`;

  const solved = (teamProgress.solvedPuzzles || []).includes(puzzleId);
  if (solved) {
    element.style.opacity = "0.7";
    element.style.backgroundColor = "#e8f5e8";
  }

  element.onclick = () => openPuzzle(puzzleId);

  element.innerHTML = `
    <div style="font-size: 12px; font-weight: bold; margin-bottom: 5px;">${puzzle.name}</div>
    <div style="font-size: 10px;">${puzzle.type.toUpperCase()}</div>
  `;

  return element;
}

function openPuzzle(puzzleId) {
  currentPuzzle = puzzleId;
  const puzzle = puzzleData[puzzleId];
  const modal = document.getElementById("puzzle-modal");
  const frame = document.getElementById("puzzle-frame");
  const answerSection = document.getElementById("answer-section");

  document.getElementById("single-answer").classList.add("hidden");
  document.getElementById("multiple-answers").classList.add("hidden");
  document.getElementById("followup-section").classList.add("hidden");
  document.getElementById("unlock-section").classList.add("hidden");
  document.getElementById("unlocked-new-section").classList.add("hidden");
  document.getElementById("solved-answer").classList.add("hidden");
  document.getElementById("solved-multi-answer").classList.add("hidden");
  document.getElementById("lock-description").classList.add("hidden");
  document.getElementById("solve-message-section").classList.add("hidden");

  if (puzzle.pdf) {
    frame.src = puzzle.pdf;
    frame.style.display = "block";
  } else {
    frame.style.display = "none";
  }

  const solved = (teamProgress.solvedPuzzles || []).includes(puzzleId);

  if (solved) {
    if (puzzle.type === "lock") {
      const solvedDiv = document.getElementById("solved-multi-answer");
      solvedDiv.innerHTML =
        "Solved answers: " +
        puzzle.answers
          .map((_, i) => `<span class="solved-answer">Answer ${i + 1}</span>`)
          .join(", ");
      solvedDiv.classList.remove("hidden");
    } else if (puzzle.hasAnswer) {
      const solvedDiv = document.getElementById("solved-answer");
      solvedDiv.textContent = "Solved answer: [answer hidden for security]";
      solvedDiv.classList.remove("hidden");
    }

    if (puzzle.followup) {
      document.getElementById("followup-section").classList.remove("hidden");
    }

    if (
      puzzle.unlocks &&
      !(teamProgress.unlockedRooms || []).includes(puzzle.unlocks)
    ) {
      document.getElementById("unlock-section").classList.remove("hidden");
    }

    // Show solve message button if puzzle has solve message
    if (puzzle.solveMessage) {
      document.getElementById("solve-message-section").classList.remove("hidden");
    }

    answerSection.classList.remove("hidden");
  } else if (puzzle.hasAnswer) {
    answerSection.classList.remove("hidden");

    if (puzzle.type === "lock") {
      document.getElementById("multiple-answers").classList.remove("hidden");
      document.getElementById("lock-description").textContent = puzzle.description || `Submit ${puzzle.requiredCorrect || puzzle.answers.length} correct answers`;
      document.getElementById("lock-description").classList.remove("hidden");
      const inputsContainer = document.getElementById("answer-inputs");
      inputsContainer.innerHTML = "";

      puzzle.answers.forEach((_, index) => {
        const div = document.createElement("div");
        div.className = "lock-answer-row";
        div.innerHTML = `
          <label class="lock-answer-label">Answer ${index + 1}:</label>
          <input type="text" id="answer-${index}" class="lock-answer-input" placeholder="Enter answer ${index + 1}">
        `;
        inputsContainer.appendChild(div);
      });

      updateGuessCounter(puzzleId, true);
    } else {
      document.getElementById("single-answer").classList.remove("hidden");
      document.getElementById("puzzle-answer").value = "";

      updateGuessCounter(puzzleId, false);
    }
  } else {
    answerSection.classList.add("hidden");
  }
  
  const hintSection = document.getElementById("hint-section");
  hintSection.classList.toggle('hidden', !puzzle.hints?.length);
  if (puzzle.hints) {
      answerSection.classList.remove("hidden");
      renderHints(puzzle);
  }

  modal.style.display = "block";
}


function closePuzzleModal() {
  document.getElementById("puzzle-modal").style.display = "none";
}

function toggleFullscreen() {
    const frame = document.getElementById("puzzle-frame");
    frame.classList.toggle("fullscreen");
    document.body.style.overflow = frame.classList.contains("fullscreen") ? "hidden" : "";
}

function updateGuessCounter(puzzleId, isMulti) {
  const guessCounts = teamProgress.guessCount || {};
  const counterElement = isMulti
    ? document.getElementById("multi-guess-counter")
    : document.getElementById("guess-counter");

  const remaining =
    (puzzleData[puzzleId].maxGuesses || 0) - (guessCounts[puzzleId] || 0);

  if (puzzleData[puzzleId].maxGuesses > 0) {
    counterElement.textContent = `Guesses remaining: ${remaining}`;
  } else {
    counterElement.textContent = "";
  }
}

function renderHints(puzzle) {
    const hintList = document.getElementById('hint-list');
    hintList.innerHTML = '';
    
    // Safely handle puzzles without hints
    if (!puzzle.hints || !Array.isArray(puzzle.hints) || puzzle.hints.length === 0) {
        document.getElementById('hint-section').classList.add('hidden');
        return;
    }
    
    // Show hint section only if there are hints
    document.getElementById('hint-section').classList.remove('hidden');
    
    // Initialize viewedHints array if it doesn't exist
    teamProgress.viewedHints = teamProgress.viewedHints || [];
    
    puzzle.hints.forEach((hint, index) => {
        // Skip invalid hints
        if (!hint || typeof hint !== 'object' || !hint.problem || !hint.text) {
            console.warn('Invalid hint found at index', index, 'in puzzle', currentPuzzle);
            return;
        }
        
        const hintItem = document.createElement('div');
        hintItem.className = 'hint-item';
        hintItem.innerHTML = `
            <div class="hint-problem">${hint.problem}</div>
            ${teamProgress.viewedHints.includes(hint.text) ? 
                `<div class="hint-text visible">${hint.text}</div>` :
                `<button class="hint-reveal-btn" 
                    onclick="revealHint(${index})"
                    ${teamProgress.viewedHints.length >= 10 ? 'disabled' : ''}>
                    Show Hint
                </button>`
            }
        `;
        hintList.appendChild(hintItem);
    });
    
    document.getElementById('hint-counter').textContent = teamProgress.viewedHints.length;
}

async function revealHint(hintIndex) {
    try {
        const puzzle = puzzleData[currentPuzzle];
        
        // Validate puzzle and hint data
        if (!puzzle || !puzzle.hints || !Array.isArray(puzzle.hints)) {
            showNotification('Puzzle data not found', 'error');
            return;
        }
        
        if (hintIndex === undefined || hintIndex === null || hintIndex < 0 || hintIndex >= puzzle.hints.length) {
            showNotification('Invalid hint reference', 'error');
            return;
        }
        
        const hint = puzzle.hints[hintIndex];
        if (!hint || !hint.text) {
            showNotification('Hint content not found', 'error');
            return;
        }
        
        // Initialize viewedHints if it doesn't exist
        teamProgress.viewedHints = teamProgress.viewedHints || [];
        
        if (teamProgress.viewedHints.length >= 10) {
            showNotification('You have reached the maximum of 10 hints!', 'error');
            return;
        }
        
        if (!teamProgress.viewedHints.includes(hint.text)) {
            teamProgress.viewedHints.push(hint.text);
            await db.collection("progress").doc(currentUser.uid).set(teamProgress);
            
            // Update UI
            const hintItems = document.querySelectorAll('.hint-item');
            if (hintItems[hintIndex]) {
                const btn = hintItems[hintIndex].querySelector('button');
                if (btn) {
                    btn.remove();
                    const textDiv = document.createElement('div');
                    textDiv.className = 'hint-text visible';
                    textDiv.textContent = hint.text;
                    hintItems[hintIndex].appendChild(textDiv);
                }
            }
            
            document.getElementById('hint-counter').textContent = teamProgress.viewedHints.length;
        }
    } catch (error) {
        console.error('Error revealing hint:', error);
        showNotification('Error revealing hint', 'error');
    }
}


async function submitAnswer() {
  const puzzleId = currentPuzzle;
  const puzzle = puzzleData[puzzleId];
  const answer = normalizeAnswer(document.getElementById("puzzle-answer").value);

  if (!answer) {
    showNotification("Please enter an answer", "error");
    return;
  }

  try {
    if (checkAnswer(answer, puzzle.answers)) {
      await handleCorrectAnswer(puzzleId);
    } else {
      // Check if they're out of guesses before counting this attempt
      const currentGuesses = (teamProgress.guessCount || {})[puzzleId] || 0;
      const maxGuesses = puzzle.maxGuesses || 0;
      
      if (maxGuesses > 0 && currentGuesses >= maxGuesses) {
        showNotification("You're out of guesses for this puzzle", "error");
        return;
      }
      
      await handleIncorrectAnswer(puzzleId);
      showNotification("Incorrect answer. Please try again.", "error");
    }
  } catch (error) {
    console.error("Error submitting answer:", error);
    showNotification("Error submitting answer: " + error.message, "error");
  }
}

async function submitMultipleAnswers() {
  const puzzleId = currentPuzzle;
  const puzzle = puzzleData[puzzleId];
  const inputsContainer = document.getElementById("answer-inputs");
  const inputs = inputsContainer.getElementsByTagName("input");

    const answers = [];
    for (let i = 0; i < inputs.length; i++) {
        answers.push(normalizeAnswer(inputs[i].value));
    }

  if (answers.some((a) => !a)) {
    showNotification("Please fill in all answers", "error");
    return;
  }

  try {
    let correctCount = 0;
    for (let i = 0; i < answers.length; i++) {
      if (checkAnswer(answers[i], [puzzle.answers[i]])) {
        correctCount++;
      }
    }

    const requiredCorrect = puzzle.requiredCorrect || puzzle.answers.length;
    if (correctCount >= requiredCorrect) {
      await handleCorrectAnswer(puzzleId);
    } else {
      // Check if they're out of guesses before counting this attempt
      const currentGuesses = (teamProgress.guessCount || {})[puzzleId] || 0;
      const maxGuesses = puzzle.maxGuesses || 0;
      
      if (maxGuesses > 0 && currentGuesses >= maxGuesses) {
        showNotification("You're out of guesses for this puzzle", "error");
        return;
      }
      
      await handleIncorrectAnswer(puzzleId);
      showNotification(`You got ${correctCount} out of ${requiredCorrect} required answers correct. Please try again.`, "error");
    }
  } catch (error) {
    console.error("Error submitting answers:", error);
    showNotification("Error submitting answers: " + error.message, "error");
  }
}

async function handleCorrectAnswer(puzzleId) {
  const puzzle = puzzleData[puzzleId];

  if (!teamProgress.solvedPuzzles.includes(puzzleId)) {
    teamProgress.solvedPuzzles.push(puzzleId);
  }

  // Handle puzzle unlocks
  if (puzzle.unlocks && !teamProgress.unlockedRooms.includes(puzzle.unlocks)) {
    teamProgress.unlockedRooms.push(puzzle.unlocks);
    unlockedNewContent[puzzle.unlocks] = puzzleId;
  }

  // Check and handle room clearance
  const roomId = currentRoom;
  if (isRoomCleared(roomId) && !teamProgress.clearedRooms.includes(roomId)) {
    teamProgress.clearedRooms.push(roomId);
    
    // Handle room clear unlock
    const room = roomData[roomId];
    if (room.clearUnlock) {
      // Fixed handling for clearUnlock format
      const unlockType = room.clearUnlock.type; // 'room' or 'puzzle'
      const unlockId = room.clearUnlock.id;
      
      if (unlockType === 'room' && !teamProgress.unlockedRooms.includes(unlockId)) {
        teamProgress.unlockedRooms.push(unlockId);
        unlockedNewContent[unlockId] = roomId;
      }
      // Add puzzle unlock logic if needed
    }

    // Find next uncleared room
    const nextRoom = teamProgress.unlockedRooms.find(r => 
      !teamProgress.clearedRooms.includes(r)
    );
    if (nextRoom) {
      teamProgress.currentRoom = nextRoom;
      currentRoom = nextRoom;
    }
  }

  await db.collection("progress").doc(currentUser.uid).set(teamProgress);
  showNotification("Correct answer! Puzzle marked as solved.", "success");

  if (puzzle.solveMessage) {
    setTimeout(() => showSolveMessage(puzzleId), 1000);
  }

  closePuzzleModal();
  renderCurrentRoom();
}

async function handleIncorrectAnswer(puzzleId) {
  if (!teamProgress.guessCount) teamProgress.guessCount = {};
  teamProgress.guessCount[puzzleId] =
    (teamProgress.guessCount[puzzleId] || 0) + 1;

  await db.collection("progress").doc(currentUser.uid).set(teamProgress);

  updateGuessCounter(puzzleId, puzzleData[puzzleId].type === "lock");

  if (teamProgress.guessCount[puzzleId] >= puzzleData[puzzleId].maxGuesses) {
    showNotification("You have used all your guesses for this puzzle.", "error");
    closePuzzleModal();
  }
}

function scheduleDailyGuessReset() {
  const now = new Date();
  const pstOffset = -7 * 60 * 60 * 1000;
  const pdtOffset = -8 * 60 * 60 * 1000;
  const isDST =
    new Date().getTimezoneOffset() <
    Math.abs(new Date(2023, 0).getTimezoneOffset());
  const offset = isDST ? pdtOffset : pstOffset;

  const resetTime = new Date(now.getTime() + offset);
  resetTime.setHours(12, 0, 0, 0);

  if (resetTime.getTime() < now.getTime()) {
    resetTime.setDate(resetTime.getDate() + 1);
  }

  const timeUntilReset = resetTime.getTime() - now.getTime();

  setTimeout(async () => {
    if (currentUser) {
      teamProgress.guessCount = {};
      await db.collection("progress").doc(currentUser.uid).set(teamProgress);

      scheduleDailyGuessReset();
    }
  }, timeUntilReset);
}

function switchRoom(roomId) {
  currentRoom = roomId;

  // Mark new unlocks as viewed
  if (unlockedNewContent[roomId]) {
    const sourceId = unlockedNewContent[roomId];
    delete unlockedNewContent[roomId];

    if (!teamProgress.viewedUnlocks) teamProgress.viewedUnlocks = [];
    if (!teamProgress.viewedUnlocks.includes(roomId)) {
      teamProgress.viewedUnlocks.push(roomId);
      db.collection("progress").doc(currentUser.uid).set(teamProgress);
    }
  }

  renderCurrentRoom();
}

function viewFollowup() {
  const puzzle = puzzleData[currentPuzzle];
  if (puzzle.followup) {
    openPuzzle(puzzle.followup);
  }
}

function goToUnlockedRoom() {
  const puzzle = puzzleData[currentPuzzle];
  if (puzzle.unlocks) {
    switchRoom(puzzle.unlocks);
    closePuzzleModal();
  }
}

function goToUnlockedNew() {
  const puzzle = puzzleData[currentPuzzle];
  if (puzzle.unlocks) {
    switchRoom(puzzle.unlocks);
    closePuzzleModal();
  } else if (puzzle.followup) {
    openPuzzle(puzzle.followup);
  }
}

function viewOriginalPuzzle() {
  openPuzzle(currentPuzzle);
}

function init() {
  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      loadTeamData();
      scheduleDailyGuessReset();
    } else {
      showAuthPage();
    }
  });
}

window.onload = init;
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
const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebase.database();

const SECURITY_SALT = "partial-insanity-salt";
let currentUser = null;
let currentTeam = null;
let currentRoom = "starting_room";
let currentPuzzle = null;
let puzzleData = {};
let roomData = {};
let teamProgress = {};
let unlockedNewContent = {};
let unlockedPuzzlesInRoom = {};
let correctAnswersSoFar = {};
let answerBoxVisible = false;
let hintBoxVisible = false;

auth.onAuthStateChanged((user) => {
  if (user) {
    currentUser = user;
    loadTeamData();
  } else {
    currentUser = null;
    showAuthPage();
  }
});

function checkAnswer(answer, encryptedAnswers) {
  try {
    if (!Array.isArray(encryptedAnswers)) {
      console.error("Invalid encryptedAnswers format");
      return false;
    }

    const normalizedAnswer = answer.toString().toUpperCase();
    return encryptedAnswers.some((encrypted) => {
      try {
        const decrypted = decryptAnswer(encrypted);
        return decrypted.toUpperCase() === normalizedAnswer;
      } catch (e) {
        console.error("Error decrypting answer:", e);
        return false;
      }
    });
  } catch (error) {
    console.error("Error checking answer:", error);
    return false;
  }
}

async function loadTeamData() {
  try {
    const teamDoc = await db.collection("teams").doc(currentUser.uid).get();
    if (teamDoc.exists) {
      currentTeam = teamDoc.data();
      document.getElementById("team-info").textContent =
        `Team: ${currentTeam.name}`;

      const progressDoc = await db
        .collection("progress")
        .doc(currentUser.uid)
        .get();
      if (progressDoc.exists) {
        teamProgress = progressDoc.data();
        teamProgress.triggeredEvents = teamProgress.triggeredEvents || {};

        teamProgress.solvedPuzzles = teamProgress.solvedPuzzles || [];
        teamProgress.unlockedRooms = teamProgress.unlockedRooms || [
          "starting_room",
        ];
        teamProgress.guessCount = teamProgress.guessCount || {};
        teamProgress.clearedRooms = teamProgress.clearedRooms || [];
        teamProgress.viewedUnlocks = teamProgress.viewedUnlocks || [];
        if (!teamProgress.unlockedPuzzlesInRoom)
          teamProgress.unlockedPuzzlesInRoom = {};
        unlockedPuzzlesInRoom = teamProgress.unlockedPuzzlesInRoom;

        const unlockedRooms = teamProgress.unlockedRooms;
        const clearedRooms = teamProgress.clearedRooms;

        let firstUncleared = unlockedRooms.find(
          (roomId) => !clearedRooms.includes(roomId),
        );

        if (!firstUncleared && unlockedRooms.length > 0) {
          firstUncleared = unlockedRooms[unlockedRooms.length - 1];
        }

        currentRoom = firstUncleared || "starting_room";

        if (teamProgress.currentRoom !== currentRoom) {
          teamProgress.currentRoom = currentRoom;
          await db
            .collection("progress")
            .doc(currentUser.uid)
            .set(teamProgress);
        }
      } else {
        teamProgress = {
          solvedPuzzles: [],
          currentRoom: "starting_room",
          unlockedRooms: ["starting_room"],
          guessCount: {},
          viewedUnlocks: [],
          clearedRooms: [],
          triggeredEvents: {},
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

  const conditionType =
    typeof clearCondition === "string" ? clearCondition : clearCondition.type;

  switch (conditionType) {
    case "fullsolve":
      return roomPuzzles.every((puzzleId) => solvedPuzzles.includes(puzzleId));

    case "partialsolve": {
      const requiredCount =
        typeof clearCondition === "object"
          ? clearCondition.count || 1
          : room.clearCount || 1;
      const solvedCount = roomPuzzles.filter((puzzleId) =>
        solvedPuzzles.includes(puzzleId),
      ).length;
      return solvedCount >= requiredCount;
    }

    case "meta": {
      const metaPuzzles = roomPuzzles.filter(
        (puzzleId) => puzzleData[puzzleId]?.type === "meta",
      );
      return metaPuzzles.every((puzzleId) => solvedPuzzles.includes(puzzleId));
    }

    case "lock": {
      const lockPuzzles = roomPuzzles.filter(
        (puzzleId) => puzzleData[puzzleId]?.type === "lock",
      );
      return lockPuzzles.every((puzzleId) => solvedPuzzles.includes(puzzleId));
    }

    case "mustsolve": {
      const mustSolvePuzzles =
        typeof clearCondition === "object"
          ? clearCondition.puzzles || []
          : room.mustSolvePuzzles || [];
      return mustSolvePuzzles.every((puzzleId) =>
        solvedPuzzles.includes(puzzleId),
      );
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

  Object.keys(puzzleData).forEach((puzzleId) => {
    const puzzle = puzzleData[puzzleId];
    if (
      puzzle.unlocks &&
      teamProgress.solvedPuzzles.includes(puzzleId) &&
      !teamProgress.viewedUnlocks?.includes(puzzle.unlocks)
    ) {
      unlockedNewContent[puzzle.unlocks] = puzzleId;
    }
  });

  teamProgress.clearedRooms.forEach((roomId) => {
    const room = roomData[roomId];
    if (room.clearUnlock) {
      const unlockType = room.clearUnlock?.type || "";
      const unlockId = room.clearUnlock?.id || "";
      if (
        unlockType === "room" &&
        !teamProgress.viewedUnlocks?.includes(unlockId) &&
        !teamProgress.unlockedRooms.includes(unlockId)
      ) {
        unlockedNewContent[unlockId] = roomId;
      }
    }
  });
}

async function loadRoomEvents(roomId) {
  try {
    if (roomData[roomId] && Array.isArray(roomData[roomId].events)) {
      return roomData[roomId].events;
    }

    const roomDoc = await db
      .collection("rooms")
      .doc("config")
      .collection(roomId)
      .doc("config")
      .get();

    if (roomDoc.exists) {
      const roomDataFromFirebase = roomDoc.data();

      if (Array.isArray(roomDataFromFirebase.events)) {
        return roomDataFromFirebase.events;
      }
    }

    return [];
  } catch (error) {
    console.error("Error loading room events:", error);
    return [];
  }
}
async function checkAndTriggerRoomEvents(roomId) {
  try {
    const events = await loadRoomEvents(roomId);

    const solvedPuzzles = teamProgress.solvedPuzzles || [];
    const roomPuzzles = roomData[roomId]?.puzzles || [];

    const solvedInRoom = roomPuzzles.filter((puzzleId) =>
      solvedPuzzles.includes(puzzleId),
    ).length;

    for (const [index, event] of events.entries()) {
      if (!event.triggerType || !event.action) {
        continue;
      }

      const eventKey = `${roomId}_${index}_${event.triggerType}_${event.triggerValue || "specific"}`;

      if (
        teamProgress.triggeredEvents &&
        teamProgress.triggeredEvents[eventKey]
      ) {
        continue;
      }

      let shouldTrigger = false;

      switch (event.triggerType) {
        case "solveCount":
          const requiredCount = parseInt(event.triggerValue) || 0;
          shouldTrigger = solvedInRoom >= requiredCount;
          break;

        case "specificPuzzles":
          const requiredPuzzles = event.puzzles || [];
          shouldTrigger = requiredPuzzles.every((puzzleId) =>
            solvedPuzzles.includes(puzzleId),
          );
          break;

        default:
          continue;
      }

      if (shouldTrigger) {
        if (!teamProgress.triggeredEvents) {
          teamProgress.triggeredEvents = {};
        }

        teamProgress.triggeredEvents[eventKey] = true;
        await db.collection("progress").doc(currentUser.uid).set(teamProgress);

        await handleEventAction(event, roomId, index);
      }
    }
  } catch (error) {
    console.error("Error checking room events:", error);
  }
}

async function handleEventAction(event, roomId, eventIndex) {
  switch (event.action) {
    case "notify":
      showNotification(event.actionValue, "error", 5000, true);
      break;

    case "unlock":
      if (puzzleData[event.actionValue]) {
        if (!unlockedPuzzlesInRoom[roomId]) unlockedPuzzlesInRoom[roomId] = [];
        if (!unlockedPuzzlesInRoom[roomId].includes(event.actionValue)) {
          unlockedPuzzlesInRoom[roomId].push(event.actionValue);

          teamProgress.unlockedPuzzlesInRoom = unlockedPuzzlesInRoom;
          await db
            .collection("progress")
            .doc(currentUser.uid)
            .set(teamProgress);
        }
      } else if (roomData[event.actionValue]) {
        if (!teamProgress.unlockedRooms.includes(event.actionValue)) {
          teamProgress.unlockedRooms.push(event.actionValue);
        }
      } else {
        if (!teamProgress.solvedPuzzles.includes(event.actionValue)) {
          unlockedNewContent[event.actionValue] = roomId;
        }
      }
      break;

    case "solve":
      if (!teamProgress.solvedPuzzles.includes(event.actionValue)) {
        teamProgress.solvedPuzzles.push(event.actionValue);
      }
      break;
  }

  await db.collection("progress").doc(currentUser.uid).set(teamProgress);

  renderCurrentRoom();
}
function showNotification(
  message,
  type = "info",
  duration = 3000,
  isEvent = false,
) {
  if (isEvent && !document.getElementById("notification-container")) {
    const container = document.createElement("div");
    container.id = "notification-container";
    container.className = "notification-container";
    document.body.appendChild(container);
  }

  const notification = document.createElement("div");

  if (isEvent) {
    notification.className = `notification-event-alert`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
      </div>
    `;

    const container = document.getElementById("notification-container");
    container.appendChild(notification);

    const notifications = container.querySelectorAll(
      ".notification-event-alert",
    );
    notifications.forEach((notif, index) => {
      notif.style.top = `${index * 70}px`;
    });
  } else {
    const isEventNotification =
      message.includes("unlocked") || message.includes("automatically solved");

    if (isEventNotification) {
      notification.className = `notification notification-${type} notification-event`;
    } else {
      notification.className = `notification notification-${type}`;
    }

    notification.innerHTML = `
      <div class="notification-content ${isEventNotification ? "notification-event" : ""}">
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
      </div>
    `;

    document.body.appendChild(notification);
  }

  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();

      if (isEvent) {
        const container = document.getElementById("notification-container");
        if (container) {
          const notifications = container.querySelectorAll(
            ".notification-event-alert",
          );
          notifications.forEach((notif, index) => {
            notif.style.top = `${index * 70}px`;
          });

          if (notifications.length === 0) {
            container.remove();
          }
        }
      }
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
  const modal = document.getElementById("solve-message-modal");
  const messageContent = document.getElementById("solve-message-content");
  messageContent.textContent = message;
  modal.style.display = "block";
}

function closeSolveMessageModal() {
  document.getElementById("solve-message-modal").style.display = "none";
}

function closeIssuesPage() {
  document.getElementById("issues-page").style.display = "none";
  showPuzzlePage();
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
  document.getElementById("leaderboard-page").style.display = "none";
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

function showIssuesPage() {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("puzzle-page").style.display = "none";
  document.getElementById("rules-page").style.display = "none";
  document.getElementById("leaderboard-page").style.display = "none";
  document.getElementById("issues-page").style.display = "block";
  loadAllIssues();
  loadMyIssues();
}

async function registerTeam() {
  const teamName = document.getElementById("new-team-name").value.trim();
  const email = document.getElementById("team-email").value.trim();
  const password = document
    .getElementById("team-password-register")
    .value.trim();
  const leaderboardOptOut = document.getElementById(
    "leaderboard-opt-out",
  ).checked;

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
      leaderboardOptOut: leaderboardOptOut,
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
        clearedRooms: [],
        lastSolveTime: 0,
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

async function renderCurrentRoom() {
  if (!roomData[currentRoom]) return;

  const room = roomData[currentRoom];

  await checkRoomPersistentUnlocks(currentRoom);

  document.getElementById("current-room-title").textContent = room.name;
  document.getElementById("room-description").textContent =
    room.description || "";

  const navGroup = document.querySelector("#room-nav-buttons .room-nav-group");
  navGroup.innerHTML = "";

  const rulesBtn = document.createElement("button");
  rulesBtn.className = "nav-btn";
  rulesBtn.textContent = "Rules";
  rulesBtn.onclick = showRulesPage;
  navGroup.appendChild(rulesBtn);

  const clearedRooms = teamProgress.clearedRooms || [];
  const unlockedRooms = teamProgress.unlockedRooms || ["starting_room"];

  unlockedRooms
    .filter((roomId) => !clearedRooms.includes(roomId))
    .forEach((roomId) => {
      const btn = createRoomButton(roomId);
      navGroup.appendChild(btn);
    });

  const dropdown = document.querySelector(
    ".cleared-rooms-dropdown .dropdown-content",
  );
  dropdown.innerHTML = clearedRooms
    .map((roomId) => {
      const room = roomData[roomId];
      return `<button onclick="switchRoom('${roomId}')">${
        room?.name || roomId
      }</button>`;
    })
    .join("");

  if (room.type === "normal") {
    renderNormalRoom(room);
  } else if (room.type === "image") {
    renderImageRoom(room);
  }
}

function normalizeAnswer(answer) {
  if (typeof answer !== "string") {
    answer = String(answer);
  }

  return answer
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
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

  room.puzzles.forEach((puzzleId) => {
    const puzzle = puzzleData[puzzleId];
    if (!puzzle) return;
    const puzzleElement = createPuzzleElement(puzzle, puzzleId);
    container.appendChild(puzzleElement);
    addFollowupPuzzles(puzzleId, container);
  });

  const unlockedForThisRoom =
    unlockedPuzzlesInRoom[room.id || currentRoom] || [];
  unlockedForThisRoom.forEach((puzzleId) => {
    if (
      !room.puzzles.includes(puzzleId) &&
      puzzleData[puzzleId] &&
      !roomData[puzzleId]
    ) {
      const puzzle = puzzleData[puzzleId];
      const puzzleElement = createPuzzleElement(puzzle, puzzleId);
      container.appendChild(puzzleElement);
      addFollowupPuzzles(puzzleId, container);
    }
  });
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
    addFloatingFollowupPuzzles(puzzleId, container);
  });

  const unlockedForThisRoom =
    unlockedPuzzlesInRoom[room.id || currentRoom] || [];
  unlockedForThisRoom.forEach((puzzleId) => {
    if (
      !room.puzzles.includes(puzzleId) &&
      puzzleData[puzzleId] &&
      !roomData[puzzleId]
    ) {
      const puzzle = puzzleData[puzzleId];
      const puzzleElement = createFloatingPuzzleElement(puzzle, puzzleId);
      container.appendChild(puzzleElement);
      addFloatingFollowupPuzzles(puzzleId, container);
    }
  });
}

function addFollowupPuzzles(puzzleId, container) {
  const solvedPuzzles = teamProgress.solvedPuzzles || [];
  const puzzle = puzzleData[puzzleId];

  if (puzzle && puzzle.followup && solvedPuzzles.includes(puzzleId)) {
    const followupPuzzle = puzzleData[puzzle.followup];
    if (followupPuzzle) {
      const followupElement = createPuzzleElement(
        followupPuzzle,
        puzzle.followup,
      );
      followupElement.classList.add("followup-puzzle");
      container.appendChild(followupElement);

      addFollowupPuzzles(puzzle.followup, container);
    }
  }
}

function addFloatingFollowupPuzzles(puzzleId, container) {
  const solvedPuzzles = teamProgress.solvedPuzzles || [];
  const puzzle = puzzleData[puzzleId];

  if (puzzle && puzzle.followup && solvedPuzzles.includes(puzzleId)) {
    const followupPuzzle = puzzleData[puzzle.followup];
    if (followupPuzzle) {
      const followupElement = createFloatingPuzzleElement(
        followupPuzzle,
        puzzle.followup,
      );
      followupElement.classList.add("followup-puzzle");

      const parentElement = container.querySelector(
        `[onclick="openPuzzle('${puzzleId}')"]`,
      );
      if (parentElement) {
        const parentLeft = parseInt(parentElement.style.left) || 100;
        const parentTop = parseInt(parentElement.style.top) || 100;
        followupElement.style.left = parentLeft + 20 + "px";
        followupElement.style.top = parentTop + 20 + "px";
      }
      container.appendChild(followupElement);

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

  element.onclick = () => openPuzzleFullscreen(puzzleId);

  const coverImage = getCoverImage(puzzle);
  const answer =
    solved && puzzle.answers && puzzle.answers.length > 0
      ? decryptAnswer(puzzle.answers[0])
      : null;

  element.innerHTML = `
    <div class="puzzle-preview">
      ${
        coverImage
          ? `
        <div class="puzzle-preview-container">
          <img src="${
            coverImage.url
          }" alt="Puzzle Preview" class="puzzle-cover">
          ${answer ? `<div class="puzzle-answer-overlay">${answer.toUpperCase()}</div>` : ""}
        </div>
      `
          : puzzle.media.find((m) => m.type === "pdf")
            ? `
        <iframe src="${
          puzzle.media.find((m) => m.type === "pdf").url
        }#view=fitH" width="100%" height="100%" style="border: none; pointer-events: none;"></iframe>
      `
            : puzzle.type === "lock"
              ? `
        <div style="padding: 20px; text-align: center;">${
          puzzle.description || "Lock Puzzle"
        }</div>
      `
              : '<div style="padding: 20px; text-align: center;">Puzzle</div>'
      }
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

  element.style.left = (puzzle.position?.x || 100) + "px";
  element.style.top = (puzzle.position?.y || 100) + "px";
  element.style.transform = `rotate(${puzzle.position?.rotation || 0}deg)`;

  const solved = (teamProgress.solvedPuzzles || []).includes(puzzleId);
  if (solved) {
    element.style.opacity = "0.7";
    element.style.backgroundColor = "#e8f5e8";
  }

  element.onclick = () => openPuzzleFullscreen(puzzleId);

  const coverImage = getCoverImage(puzzle);

  element.innerHTML = `
    <div class="floating-puzzle-cover-container">
      ${
        coverImage
          ? `<img src="${coverImage.url}" alt="Puzzle Preview" class="floating-puzzle-cover">`
          : puzzle.type === "lock"
            ? puzzle.description
            : ""
      }
    </div>
    <div style="font-size: 12px; font-weight: bold; text-align: center;">${
      puzzle.name
    }</div>
    <div style="font-size: 10px; text-align: center;">${puzzle.type.toUpperCase()}</div>
  `;

  return element;
}

function getCoverImage(puzzle) {
  if (!puzzle.media) return null;

  const coverImage = puzzle.media.find((m) => m.type === "jpg-cover");
  if (coverImage) return coverImage;

  const contentImages = puzzle.media.filter((m) => m.type === "jpg-content");
  if (contentImages.length > 0) return contentImages[0];

  return null;
}

let currentPuzzleViewer = null;

function openPuzzleFullscreen(puzzleId) {
  answerBoxVisible = false;
  hintBoxVisible = false;
  currentPuzzle = puzzleId;
  const puzzle = puzzleData[puzzleId];
  const isSolved = (teamProgress.solvedPuzzles || []).includes(puzzleId);

  closePuzzleViewer();

  currentPuzzleViewer = document.createElement("div");
  currentPuzzleViewer.className = "puzzle-viewer";
  document.body.appendChild(currentPuzzleViewer);

  const header = document.createElement("div");
  header.className = "puzzle-viewer-header";

  const title = document.createElement("h2");
  title.textContent = puzzle.name;

  if (isSolved && puzzle.answers && puzzle.answers.length > 0) {
    const answer = document.createElement("div");
    answer.className = "puzzle-viewer-answer";
    answer.textContent = `Answer: ${decryptAnswer(puzzle.answers[0])}`;
    header.appendChild(answer);
  }

  const actions = document.createElement("div");
  actions.className = "puzzle-viewer-actions";

  const exitBtn = document.createElement("button");
  exitBtn.className = "btn btn-secondary";
  exitBtn.textContent = "Exit";
  exitBtn.onclick = closePuzzleViewer;

  actions.appendChild(exitBtn);

  if (puzzle.media.find((m) => m.type === "pdf")) {
    const pdfBtn = document.createElement("button");
    pdfBtn.className = "btn btn-primary";
    pdfBtn.textContent = "View PDF";
    pdfBtn.onclick = () =>
      window.open(puzzle.media.find((m) => m.type === "pdf").url, "_blank");
    actions.appendChild(pdfBtn);
  }

  const sheetMedia = puzzle.media?.find((m) => m.type === "sheet");
  if (sheetMedia) {
    const sheetBtn = document.createElement("button");
    sheetBtn.className = "btn btn-primary";
    sheetBtn.textContent = "Google Sheet";
    sheetBtn.onclick = () => window.open(sheetMedia.url, "_blank");
    actions.appendChild(sheetBtn);
  }

  if (!isSolved) {
    if (puzzle.hasAnswer) {
      const answerBtn = document.createElement("button");
      answerBtn.className = "btn btn-primary";
      answerBtn.textContent = "Check Answer";
      answerBtn.onclick = function () {
        initAnswerBox(puzzle);
        toggleAnswerBox();
      };
      actions.appendChild(answerBtn);
    }

    if (puzzle.hints?.length > 0) {
      const hintBtn = document.createElement("button");
      hintBtn.className = "btn btn-primary";
      hintBtn.textContent = "Hints";
      hintBtn.onclick = toggleHintBox;
      actions.appendChild(hintBtn);
    }
  }

  header.appendChild(title);
  header.appendChild(actions);
  currentPuzzleViewer.appendChild(header);

  const content = document.createElement("div");
  content.className = "puzzle-viewer-content";

  const contentImages = getContentImages(puzzle);
  if (contentImages.length > 0) {
    contentImages.forEach((img) => {
      const imgEl = document.createElement("img");
      imgEl.className = "puzzle-viewer-image";
      imgEl.src = img.url;
      imgEl.alt = puzzle.name;
      content.appendChild(imgEl);
    });
  } else if (puzzle.media.find((m) => m.type === "pdf")) {
    const iframe = document.createElement("iframe");
    iframe.src = `${puzzle.media.find((m) => m.type === "pdf").url}#view=fitH`;
    iframe.className = "pdf-iframe";
    content.appendChild(iframe);
  } else {
    const desc = document.createElement("div");
    desc.className = "puzzle-description";
    desc.textContent = puzzle.description || "Puzzle content";
    content.appendChild(desc);
  }

  currentPuzzleViewer.appendChild(content);

  if (!isSolved) {
    if (puzzle.hasAnswer) initAnswerBox(puzzle);
    if (puzzle.hints?.length > 0) initHintBox(puzzle);
  }

  document.addEventListener("click", handleClickOutside);
}

function closePuzzleViewer() {
  if (currentPuzzleViewer) {
    currentPuzzleViewer.remove();
    currentPuzzleViewer = null;
  }
  answerBoxVisible = false;
  hintBoxVisible = false;
  document.getElementById("answer-box")?.remove();
  document.getElementById("hint-box")?.remove();
  document.removeEventListener("click", handleClickOutside);
}

function handleClickOutside(event) {
  const answerBox = document.getElementById("answer-box");
  const hintBox = document.getElementById("hint-box");

  if (answerBoxVisible && answerBox && !answerBox.contains(event.target)) {
    const answerBtn = document.querySelector(
      '.puzzle-viewer-actions button[onclick="toggleAnswerBox()"]',
    );
    if (answerBtn && !answerBtn.contains(event.target)) {
      toggleAnswerBox();
    }
  }

  if (hintBoxVisible && hintBox && !hintBox.contains(event.target)) {
    const hintBtn = document.querySelector(
      '.puzzle-viewer-actions button[onclick="toggleHintBox()"]',
    );
    if (hintBtn && !hintBtn.contains(event.target)) {
      toggleHintBox();
    }
  }
}

function initAnswerBox(puzzle) {
  document.getElementById("answer-box")?.remove();

  const box = document.createElement("div");
  box.className = "answer-box";
  box.id = "answer-box";

  const answers = puzzle.answers || [];
  const requiredCorrect = puzzle.requiredCorrect || answers.length;

  if (answers.length === 1) {
    box.innerHTML = `
      <h3>Submit Answer</h3>
      <button class="close-box" onclick="toggleAnswerBox()">✖</button>
      <div id="answer-inputs"></div>
      <button class="submit-btn" onclick="submitMultipleAnswers()">Submit</button>
      <div class="guess-counter" id="guess-counter"></div>
    `;
  } else {
    box.innerHTML = `
      <h3>Submit Answers</h3>
      <button class="close-box" onclick="toggleAnswerBox()">✖</button>
      <div id="answer-inputs"></div>
      <div class="required-correct">Require ${requiredCorrect} correct answer(s) to solve</div>
      <button class="submit-btn" onclick="submitMultipleAnswers()">Submit</button>
      <div class="guess-counter" id="guess-counter"></div>
    `;
  }

  const inputsContainer = box.querySelector("#answer-inputs");
  correctAnswersSoFar[currentPuzzle] = correctAnswersSoFar[currentPuzzle] || Array(answers.length).fill(false);
  answers.forEach((_, index) => {
    const div = document.createElement("div");
    div.className = "lock-answer-row";
    if (answers.length === 1) {

      div.innerHTML = `
        <input type="text" id="answer-0" class="lock-answer-input" placeholder="Enter answer">
      `;
    } else {

      div.innerHTML = `
        <label class="lock-answer-label">Answer ${index + 1}:</label>
        <input type="text" id="answer-${index}" class="lock-answer-input" placeholder="Enter answer ${index + 1}">
        <span class="answer-correct-indicator" id="answer-indicator-${index}"></span>
      `;
    }
    inputsContainer.appendChild(div);
  });

  if (answers.length > 1 && correctAnswersSoFar[currentPuzzle]) {
    correctAnswersSoFar[currentPuzzle].forEach((isCorrect, i) => {
      const input = document.getElementById(`answer-${i}`);
      const indicator = document.getElementById(`answer-indicator-${i}`);
      if (isCorrect && input) {
        input.disabled = true;
        input.style.borderColor = "#28a745";
        if (indicator) {
          indicator.textContent = "✔️";
          indicator.style.color = "#28a745";
        }
      }
    });
  }

  document.body.appendChild(box);
  updateGuessCounter(currentPuzzle, true);
}

function initHintBox(puzzle) {
  document.getElementById("hint-box")?.remove();

  if (!puzzle.hints?.length) return;

  const box = document.createElement("div");
  box.className = "hint-box";
  box.id = "hint-box";
  box.innerHTML = `
    <h3>Hints</h3>
    <button class="close-box" onclick="toggleHintBox()">✖</button>
    <div id="hint-list"></div>
  `;

  document.body.appendChild(box);
  renderHints(puzzle);
}

function toggleAnswerBox() {
  const box = document.getElementById("answer-box");
  if (box) {
    answerBoxVisible = !answerBoxVisible;
    box.style.display = answerBoxVisible ? "block" : "none";

    if (answerBoxVisible) {
      const hintBox = document.getElementById("hint-box");
      if (hintBox) {
        hintBox.style.display = "none";
        hintBoxVisible = false;
      }
    }
  }
}

function toggleHintBox() {
  const box = document.getElementById("hint-box");
  if (box) {
    hintBoxVisible = !hintBoxVisible;
    box.style.display = hintBoxVisible ? "block" : "none";

    if (hintBoxVisible) {
      const answerBox = document.getElementById("answer-box");
      if (answerBox) {
        answerBox.style.display = "none";
        answerBoxVisible = false;
      }
    }
  }
}

function getContentImages(puzzle) {
  if (!puzzle.media) return [];
  return puzzle.media
    .filter((m) => m.type === "jpg-content")
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function renderHints(puzzle) {
  const hintList = document.getElementById("hint-list");
  if (!hintList) return;

  hintList.innerHTML = "";

  teamProgress.viewedHints = teamProgress.viewedHints || [];

  puzzle.hints.forEach((hint, index) => {
    if (!hint || typeof hint !== "object" || !hint.problem || !hint.text) {
      console.warn(
        "Invalid hint found at index",
        index,
        "in puzzle",
        currentPuzzle,
      );
      return;
    }

    const hintItem = document.createElement("div");
    hintItem.className = "hint-item";
    hintItem.innerHTML = `
      <div class="hint-problem">${hint.problem}</div>
      ${
        teamProgress.viewedHints.includes(hint.text)
          ? `<div class="hint-text visible">${hint.text}</div>`
          : `<button class="hint-reveal-btn" 
            onclick="revealHint(${index})"
            ${teamProgress.viewedHints.length >= 10 ? "disabled" : ""}>
            Show Hint
        </button>`
      }
    `;
    hintList.appendChild(hintItem);
  });

  const counter = document.getElementById("hint-counter");
  if (counter) {
    counter.textContent = teamProgress.viewedHints.length;
  }
}

async function revealHint(hintIndex) {
  try {
    const puzzle = puzzleData[currentPuzzle];

    if (!puzzle || !puzzle.hints || !Array.isArray(puzzle.hints)) {
      showNotification("Puzzle data not found", "error");
      return;
    }

    if (
      hintIndex === undefined ||
      hintIndex === null ||
      hintIndex < 0 ||
      hintIndex >= puzzle.hints.length
    ) {
      showNotification("Invalid hint reference", "error");
      return;
    }

    const hint = puzzle.hints[hintIndex];
    if (!hint || !hint.text) {
      showNotification("Hint content not found", "error");
      return;
    }

    teamProgress.viewedHints = teamProgress.viewedHints || [];

    if (teamProgress.viewedHints.length >= 10) {
      showNotification("You have reached the maximum of 10 hints!", "error");
      return;
    }

    if (!teamProgress.viewedHints.includes(hint.text)) {
      teamProgress.viewedHints.push(hint.text);
      await db.collection("progress").doc(currentUser.uid).set(teamProgress);

      const hintItems = document.querySelectorAll(".hint-item");
      if (hintItems[hintIndex]) {
        const btn = hintItems[hintIndex].querySelector("button");
        if (btn) {
          btn.remove();
          const textDiv = document.createElement("div");
          textDiv.className = "hint-text visible";
          textDiv.textContent = hint.text;
          hintItems[hintIndex].appendChild(textDiv);
        }
      }
    }
  } catch (error) {
    console.error("Error revealing hint:", error);
    showNotification("Error revealing hint", "error");
  }
}

async function submitMultipleAnswers() {
  const puzzleId = currentPuzzle;
  const puzzle = puzzleData[puzzleId];
  const inputsContainer = document.getElementById("answer-inputs");
  const inputs = inputsContainer.getElementsByTagName("input");

  const currentGuesses = (teamProgress.guessCount || {})[puzzleId] || 0;
  const maxGuesses = puzzle.maxGuesses || 0;
  if (maxGuesses > 0 && currentGuesses >= maxGuesses) {
    showNotification("You're out of guesses for this puzzle", "error");
    return;
  }

  const answers = [];
  for (let i = 0; i < inputs.length; i++) {
    answers.push(normalizeAnswer(inputs[i].value));
  }

  if (answers.some((a) => !a)) {
    showNotification("Please fill in all answers", "error");
    return;
  }

  try {
    if (puzzle.events) {
      for (const event of puzzle.events) {
        if (event.trigger === "answer") {
          for (const answer of answers) {
            if (checkAnswer(answer, [event.triggerValue])) {
              await handlePuzzleEvent(event);

              return;
            }
          }
        }
      }
    }

    let correctCount = 0;
    let correctArray = Array(answers.length).fill(false);

    for (let i = 0; i < answers.length; i++) {
      if (checkAnswer(answers[i], [puzzle.answers[i]])) {
        correctCount++;
        correctArray[i] = true;
      }
    }

    if (!correctAnswersSoFar[puzzleId]) correctAnswersSoFar[puzzleId] = Array(answers.length).fill(false);
    for (let i = 0; i < answers.length; i++) {
      if (correctArray[i]) correctAnswersSoFar[puzzleId][i] = true;
    }

    const requiredCorrect = puzzle.requiredCorrect || 1;
    if (correctCount >= requiredCorrect) {
      if (puzzle.events) {
        for (const event of puzzle.events) {
          if (event.trigger === "solve") {
            await handlePuzzleEvent(event);
          }
        }
      }

      await handleCorrectAnswer(puzzleId);
      correctAnswersSoFar[puzzleId] = Array(answers.length).fill(false); 
      closePuzzleViewer();
    } else {
      await handleIncorrectAnswer(puzzleId);

      if (answers.length === 1) {
        showNotification("Incorrect Answer. Please try again.", "error");
      } else {
        showNotification(
          `You got ${correctCount} out of ${requiredCorrect} required answers correct. Please try again.`,
          "error",
        );
      }

      if (answers.length > 1) {
        for (let i = 0; i < answers.length; i++) {
          const input = document.getElementById(`answer-${i}`);
          const indicator = document.getElementById(`answer-indicator-${i}`);
          if (correctAnswersSoFar[puzzleId][i]) {
            if (input) {
              input.disabled = true;
              input.style.borderColor = "#28a745";
            }
            if (indicator) {
              indicator.textContent = "✔️";
              indicator.style.color = "#28a745";
            }
          } else {

            if (input) {
              input.disabled = false;
              input.style.borderColor = "";
            }
            if (indicator) {
              indicator.textContent = "";
              indicator.style.color = "";
            }
          }
        }
      }

      updateGuessCounter(puzzleId, true);
    }
  } catch (error) {
    console.error("Error submitting answers:", error);
    showNotification("Error submitting answers: " + error.message, "error");
  }
}

async function checkRoomPersistentUnlocks(roomId) {
  try {
    const events = await loadRoomEvents(roomId);
    const solvedPuzzles = teamProgress.solvedPuzzles || [];
    const roomPuzzles = roomData[roomId]?.puzzles || [];
    let updated = false;

    for (const event of events) {
      if (event.action !== "unlock") continue;

      let shouldTrigger = false;
      switch (event.triggerType) {
        case "solveCount":
          {
            const requiredCount = parseInt(event.triggerValue) || 0;
            const solvedInRoom = roomPuzzles.filter((puzzleId) =>
              solvedPuzzles.includes(puzzleId),
            ).length;
            shouldTrigger = solvedInRoom >= requiredCount;
          }
          break;
        case "specificPuzzles":
          {
            const requiredPuzzles = event.puzzles || [];
            shouldTrigger = requiredPuzzles.every((puzzleId) =>
              solvedPuzzles.includes(puzzleId),
            );
          }
          break;
        default:
          continue;
      }

      if (shouldTrigger) {
        if (roomData[event.actionValue]) {
          if (!teamProgress.unlockedRooms.includes(event.actionValue)) {
            teamProgress.unlockedRooms.push(event.actionValue);
            updated = true;
          }
        }
      }
    }

    if (updated) {
      await db.collection("progress").doc(currentUser.uid).set(teamProgress);
    }
  } catch (error) {
    console.error("Error checking persistent room unlocks:", error);
  }
}

async function handleCorrectAnswer(puzzleId) {
  const puzzle = puzzleData[puzzleId];
  const roomId = currentRoom;

  if (!teamProgress.solvedPuzzles.includes(puzzleId)) {
    teamProgress.solvedPuzzles.push(puzzleId);
  }

  teamProgress.lastSolveTime = Date.now();

  if (puzzle.answerBindings) {
    for (const binding of puzzle.answerBindings) {
      if (
        binding.isSolveBinding &&
        !teamProgress.solvedPuzzles.includes(binding.targetPuzzle)
      ) {
        teamProgress.solvedPuzzles.push(binding.targetPuzzle);
        showNotification(
          `Puzzle "${
            puzzleData[binding.targetPuzzle]?.name || binding.targetPuzzle
          }" automatically solved!`,
          "success",
        );
      }
    }
  }

  if (puzzle.events) {
    for (const event of puzzle.events) {
      if (event.trigger === "solve") {
        await handlePuzzleEvent(event);
      }
    }
  }

  if (puzzle.unlocks && !teamProgress.unlockedRooms.includes(puzzle.unlocks)) {
    teamProgress.unlockedRooms.push(puzzle.unlocks);
    unlockedNewContent[puzzle.unlocks] = puzzleId;
  }

  await checkAndTriggerRoomEvents(roomId);

  if (isRoomCleared(roomId) && !teamProgress.clearedRooms.includes(roomId)) {
    teamProgress.clearedRooms.push(roomId);

    const room = roomData[roomId];
    if (room.clearUnlock) {
      const unlockType = room.clearUnlock.type;
      const unlockId = room.clearUnlock.id;

      if (
        unlockType === "room" &&
        !teamProgress.unlockedRooms.includes(unlockId)
      ) {
        teamProgress.unlockedRooms.push(unlockId);
        unlockedNewContent[unlockId] = roomId;
      } else if (
        unlockType === "puzzle" &&
        !teamProgress.solvedPuzzles.includes(unlockId)
      ) {
        teamProgress.solvedPuzzles.push(unlockId);
        showNotification(
          `Puzzle "${
            puzzleData[unlockId]?.name || unlockId
          }" automatically solved!`,
          "success",
        );
      }
    }

    if (room.events) {
      for (const [eventIndex, event] of room.events.entries()) {
        await handleRoomEvent(event, roomId, eventIndex);
      }
    }

    const nextRoom = teamProgress.unlockedRooms.find(
      (r) => !teamProgress.clearedRooms.includes(r),
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

  closePuzzleViewer();
  renderCurrentRoom();
}

function getRoomEventKey(roomId, eventIndex, event) {
  return `${roomId}_${eventIndex}_${event.triggerType}_${event.triggerValue || "specific"}`;
}

async function handlePuzzleEvent(event) {
  const triggerValue = event.triggerValue
    ? decryptAnswer(event.triggerValue)
    : "";

  switch (event.action) {
    case "unlock":
      if (!teamProgress.unlockedRooms.includes(event.actionValue)) {
        teamProgress.unlockedRooms.push(event.actionValue);
        showNotification(
          `New room unlocked: "${
            roomData[event.actionValue]?.name || event.actionValue
          }"`,
          "success",
        );
      }
      break;
    case "solve":
      if (!teamProgress.solvedPuzzles.includes(event.actionValue)) {
        teamProgress.solvedPuzzles.push(event.actionValue);

        teamProgress.lastSolveTime = Date.now();
        showNotification(
          `Puzzle "${
            puzzleData[event.actionValue]?.name || event.actionValue
          }" automatically solved!`,
          "success",
        );
      }
      break;
    case "notify":
      showNotification(event.actionValue, "info");
      break;
  }
  await db.collection("progress").doc(currentUser.uid).set(teamProgress);
}

async function handleRoomEvent(event, roomId, eventIndex) {
  const room = roomData[roomId];
  const solvedPuzzles = teamProgress.solvedPuzzles || [];
  const roomPuzzles = room.puzzles || [];

  let triggerMet = false;

  switch (event.triggerType) {
    case "solveCount":
      const requiredCount = parseInt(event.triggerValue) || 1;
      const solvedCount = roomPuzzles.filter((puzzleId) =>
        solvedPuzzles.includes(puzzleId),
      ).length;
      triggerMet = solvedCount >= requiredCount;
      break;

    case "specificPuzzles":
      const requiredPuzzles = event.puzzles || [];
      triggerMet = requiredPuzzles.every((puzzleId) =>
        solvedPuzzles.includes(puzzleId),
      );
      break;

    default:
      return;
  }

  const eventKey = getRoomEventKey(roomId, eventIndex, event);
  if (!teamProgress.triggeredEvents) teamProgress.triggeredEvents = {};
  if (teamProgress.triggeredEvents[eventKey]) {
    return;
  }
  if (triggerMet) {
    teamProgress.triggeredEvents[eventKey] = true;
  } else {
    return;
  }

  switch (event.action) {
    case "notify":
      showNotification(event.actionValue, "error", 5000, true);
      break;

    case "unlock":
      if (puzzleData[event.actionValue]) {
        if (!teamProgress.solvedPuzzles.includes(event.actionValue)) {
          unlockedNewContent[event.actionValue] = roomId;
        }
      } else if (roomData[event.actionValue]) {
        if (!teamProgress.unlockedRooms.includes(event.actionValue)) {
          teamProgress.unlockedRooms.push(event.actionValue);
        }
      }
      break;

    case "solve":
      if (!teamProgress.solvedPuzzles.includes(event.actionValue)) {
        teamProgress.solvedPuzzles.push(event.actionValue);

        teamProgress.lastSolveTime = Date.now();
        showNotification(
          `Puzzle "${puzzleData[event.actionValue]?.name || event.actionValue}" automatically solved!`,
          "success",
          5000,
          true,
        );
      }
      break;
  }

  await db.collection("progress").doc(currentUser.uid).set(teamProgress);

  renderCurrentRoom();
}

async function handleIncorrectAnswer(puzzleId) {
  if (!teamProgress.guessCount) teamProgress.guessCount = {};
  teamProgress.guessCount[puzzleId] =
    (teamProgress.guessCount[puzzleId] || 0) + 1;

  await db.collection("progress").doc(currentUser.uid).set(teamProgress);

  updateGuessCounter(puzzleId, puzzleData[puzzleId].type === "lock");

  if (teamProgress.guessCount[puzzleId] >= puzzleData[puzzleId].maxGuesses) {
    showNotification("You have used all your guesses for this puzzle.");
  }
}

function updateGuessCounter(puzzleId, isMulti) {
  const guessCounts = teamProgress.guessCount || {};
  const counterElement = document.getElementById("guess-counter");

  const remaining =
    (puzzleData[puzzleId].maxGuesses || 0) - (guessCounts[puzzleId] || 0);

  if (puzzleData[puzzleId].maxGuesses > 0) {
    if (remaining <= 0) {
      if (isMulti) {
        document.querySelectorAll(".lock-answer-input").forEach((input) => {
          input.disabled = true;
        });
      } else {
        document.getElementById("puzzle-answer").disabled = true;
      }
      const now = new Date();
      const pstOffset = -7 * 60 * 60 * 1000;
      const pdtOffset = -8 * 60 * 60 * 1000;
      const isDST =
        new Date().getTimezoneOffset() <
        Math.abs(new Date(2023, 0).getTimezoneOffset());
      const offset = isDST ? pdtOffset : pstOffset;

      const resetTime = new Date(now.getTime() + offset);
      resetTime.setHours(24, 0, 0, 0);

      if (resetTime.getTime() < now.getTime()) {
        resetTime.setDate(resetTime.getDate() + 1);
      }

      const timeUntilReset = resetTime.getTime() - now.getTime();
      const hours = Math.floor(timeUntilReset / (1000 * 60 * 60));
      const minutes = Math.floor(
        (timeUntilReset % (1000 * 60 * 60)) / (1000 * 60),
      );

      counterElement.innerHTML = `Guesses refresh in: ${hours}h ${minutes}m`;
    } else {
      counterElement.textContent = `Guesses remaining: ${remaining}`;
    }
  } else {
    counterElement.textContent = "";
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
  resetTime.setHours(24, 0, 0, 0);

  if (resetTime.getTime() < now.getTime()) {
    resetTime.setDate(resetTime.getDate() + 1);
  }

  const timeUntilReset = resetTime.getTime() - now.getTime();

  setTimeout(async () => {
    if (currentUser) {
      teamProgress.guessCount = {};
      await db.collection("progress").doc(currentUser.uid).set(teamProgress);

      if (currentPuzzle && document.getElementById("guess-counter")) {
        updateGuessCounter(currentPuzzle, true);
      }
      if (document.querySelectorAll(".lock-answer-input")) {
        document.querySelectorAll(".lock-answer-input").forEach((input) => {
          input.disabled = false;
        });
      }

      scheduleDailyGuessReset();
    }
  }, timeUntilReset);
}

function switchRoom(roomId) {
  currentRoom = roomId;

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

function showLeaderboard() {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("puzzle-page").style.display = "none";
  document.getElementById("rules-page").style.display = "none";
  document.getElementById("leaderboard-page").style.display = "block";

  loadLeaderboard();
}

async function loadLeaderboard() {
  try {
    document.getElementById("leaderboard-loading").style.display = "block";
    document.getElementById("leaderboard-table").style.display = "none";

    const teamsSnapshot = await db.collection("teams").get();
    const teams = [];

    for (const teamDoc of teamsSnapshot.docs) {
      const teamData = teamDoc.data();

      if (teamData.leaderboardOptOut) {
        continue;
      }

      const progressDoc = await db.collection("progress").doc(teamDoc.id).get();

      if (progressDoc.exists) {
        const progressData = progressDoc.data();

        teams.push({
          id: teamDoc.id,
          name: teamData.name,
          leaderboardOptOut: teamData.leaderboardOptOut || false,
          roomsCleared: progressData.clearedRooms
            ? progressData.clearedRooms.length
            : 0,
          puzzlesSolved: progressData.solvedPuzzles
            ? progressData.solvedPuzzles.length
            : 0,
          lastSolveTime: progressData.lastSolveTime || 0,
          progress: progressData,
        });
      }
    }

    const sortedTeams = sortTeamsForLeaderboard(teams);

    displayLeaderboard(sortedTeams);
  } catch (error) {
    console.error("Error loading leaderboard:", error);
    showNotification("Error loading leaderboard", "error");
  }
}

function sortTeamsForLeaderboard(teams) {
  return teams.sort((a, b) => {
    if (a.roomsCleared !== b.roomsCleared) {
      return b.roomsCleared - a.roomsCleared;
    }

    const allRoomsCleared =
      a.roomsCleared === (roomData ? Object.keys(roomData).length : 0);

    if (!allRoomsCleared) {
      const aLastUnclearedRoom = getLastUnclearedRoom(a.progress);
      const bLastUnclearedRoom = getLastUnclearedRoom(b.progress);

      if (aLastUnclearedRoom === bLastUnclearedRoom) {
        const aPuzzlesInRoom = countPuzzlesSolvedInRoom(
          a.progress,
          aLastUnclearedRoom,
        );
        const bPuzzlesInRoom = countPuzzlesSolvedInRoom(
          b.progress,
          bLastUnclearedRoom,
        );

        if (aPuzzlesInRoom !== bPuzzlesInRoom) {
          return bPuzzlesInRoom - aPuzzlesInRoom;
        }
      }
    }

    return a.lastSolveTime - b.lastSolveTime;
  });
}

function getLastUnclearedRoom(progress) {
  if (!progress.unlockedRooms || !progress.clearedRooms) {
    return null;
  }

  return (
    progress.unlockedRooms.find(
      (roomId) => !progress.clearedRooms.includes(roomId),
    ) || progress.unlockedRooms[progress.unlockedRooms.length - 1]
  );
}

function countPuzzlesSolvedInRoom(progress, roomId) {
  if (!roomId || !progress.solvedPuzzles || !roomData[roomId]) {
    return 0;
  }

  const roomPuzzles = roomData[roomId].puzzles || [];
  return roomPuzzles.filter((puzzleId) =>
    progress.solvedPuzzles.includes(puzzleId),
  ).length;
}

function displayLeaderboard(teams) {
  const leaderboardBody = document.getElementById("leaderboard-body");
  leaderboardBody.innerHTML = "";

  teams.forEach((team, index) => {
    const row = document.createElement("tr");
    const rank = index + 1;

    if (rank === 1) {
      row.classList.add("rank-1");
    } else if (rank === 2) {
      row.classList.add("rank-2");
    } else if (rank === 3) {
      row.classList.add("rank-3");
    }

    if (currentTeam && team.id === currentUser.uid) {
      row.classList.add("current-team");
    }

    let lastSolveTimeFormatted = "Never";
    if (team.lastSolveTime && team.lastSolveTime > 0) {
      const date = new Date(team.lastSolveTime);
      lastSolveTimeFormatted = date.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    }

    row.innerHTML = `
      <td>${rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}</td>
      <td>${team.name}</td>
      <td>${team.roomsCleared}</td>
      <td>${team.puzzlesSolved}</td>
      <td>${lastSolveTimeFormatted}</td>
    `;

    leaderboardBody.appendChild(row);
  });

  document.getElementById("leaderboard-loading").style.display = "none";
  document.getElementById("leaderboard-table").style.display = "table";
}

function submitIssue(e) {
  e.preventDefault();
  const title = document.getElementById("issue-title").value.trim();
  const description = document.getElementById("issue-description").value.trim();
  if (!title || !description) return;

  db.collection("issues").add({
    title,
    description,
    teamId: currentTeam?.id || currentUser?.uid || null,
    teamName: currentTeam?.name || null,
    timestamp: Date.now(),
    status: "open"
  }).then(() => {
    document.getElementById("issue-form").reset();
    document.getElementById("issue-success").style.display = "block";
    loadAllIssues();
    loadMyIssues();
    setTimeout(() => {
      document.getElementById("issue-success").style.display = "none";
    }, 2000);
  });
}

function loadAllIssues() {
  const list = document.getElementById("all-issues-list");
  db.collection("issues").orderBy("timestamp", "desc")
    .onSnapshot((snapshot) => {
      if (snapshot.empty) {
        list.innerHTML = "<p>No issues reported yet.</p>";
        return;
      }
      let html = "";
      snapshot.forEach(doc => {
        const issue = doc.data();
        html += `<div class="issue-card">
          <div class="issue-title">${issue.title}</div>
          <div class="issue-meta">By <b>${issue.teamName || "anonymous"}</b> at ${new Date(issue.timestamp).toLocaleString()}</div>
          <div>${issue.description}</div>
          <div class="issue-status">Status: <b>${issue.status}</b></div>
          ${issue.adminReply ? `<div class="issue-reply">Admin reply: ${issue.adminReply}</div>` : ""}
        </div>`;
      });
      list.innerHTML = html;
    });
}

function loadMyIssues() {
  const list = document.getElementById("my-issues-list");
  if (!currentUser) return;
  db.collection("issues").where("teamId", "==", currentUser.uid)
    .orderBy("timestamp", "desc")
    .onSnapshot((snapshot) => {
      if (snapshot.empty) {
        list.innerHTML = "<p>No issues submitted yet.</p>";
        return;
      }
      let html = "";
      snapshot.forEach(doc => {
        const issue = doc.data();
        html += `<div class="issue-card">
          <div class="issue-title">${issue.title}</div>
          <div class="issue-meta">${new Date(issue.timestamp).toLocaleString()}</div>
          <div>${issue.description}</div>
          <div class="issue-status">Status: <b>${issue.status}</b></div>
          ${issue.adminReply ? `<div class="issue-reply">Admin reply: ${issue.adminReply}</div>` : ""}
        </div>`;
      });
      list.innerHTML = html;
    });
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

window.onload = init;
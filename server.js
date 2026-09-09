const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // يسمح بالاتصال من موقع Netlify الخاص بك
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const allQuestions = require("./questions");

function shuffleArray(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

io.on("connection", (socket) => {
  socket.on("join_room", ({ pin, nickname }) => {
    if (!rooms[pin]) {
      rooms[pin] = {
        players: [],
        currentQuestion: 0,
        timer: null,
        selectedQuestions: [],
        answeredCount: 0,
        isPlaying: false,
      };
    }

    const room = rooms[pin];

    if (room.isPlaying) {
      socket.emit(
        "error_message",
        "عذراً، اللعبة بدأت بالفعل! لا يمكنك الانضمام الآن.",
      );
      return;
    }

    socket.join(pin);
    room.players.push({
      id: socket.id,
      nickname,
      score: 0,
      streak: 0,
      answerOrder: null,
      isCorrect: null,
      lastAddedPoints: 0, // حقل لحفظ النقاط المكتسبة للسؤال الحالي
    });

    socket.emit("join_success");
    io.to(pin).emit("update_players", room.players);
  });

  // إضافة استقبال وإرسال رسائل الدردشة
  socket.on("send_message", ({ pin, message }) => {
    const room = rooms[pin];
    if (room) {
      const player = room.players.find((p) => p.id === socket.id);
      if (player) {
        const chatData = {
          sender: player.nickname,
          message: message,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        // إرسال الرسالة لجميع الموجودين في الغرفة
        io.to(pin).emit("receive_message", chatData);
      }
    }
  });

  socket.on("start_game", ({ pin, questionCount = 10 }) => {
    const room = rooms[pin];
    if (room && !room.isPlaying) {
      room.isPlaying = true;
      room.currentQuestion = 0;
      room.selectedQuestions = shuffleArray(allQuestions).slice(
        0,
        parseInt(questionCount),
      );
      sendQuestion(pin);
    }
  });

  socket.on("send_answer", ({ pin, selectedIndex, timeRemaining }) => {
    const room = rooms[pin];
    if (room && room.selectedQuestions.length > 0) {
      const currentQ = room.selectedQuestions[room.currentQuestion];
      const player = room.players.find((p) => p.id === socket.id);

      if (player && player.answerOrder === null) {
        room.answeredCount += 1;
        player.answerOrder = room.answeredCount;

        const correctIdx =
          currentQ.correct !== undefined
            ? currentQ.correct
            : currentQ.correctIndex;
        const isCorrect = selectedIndex === correctIdx;
        player.isCorrect = isCorrect;

        let addedPoints = 0;

        if (isCorrect) {
          player.streak += 1;
          const streakBonus = Math.min((player.streak - 1) * 50, 200);
          addedPoints = 100 + timeRemaining * 10 + streakBonus;
          player.score += addedPoints;
        } else {
          player.streak = 0;
        }

        player.lastAddedPoints = addedPoints; // إسناد النقاط المكتسبة

        socket.emit("answer_result", {
          isCorrect,
          correctIndex: correctIdx,
          selectedIndex,
          streak: player.streak,
          addedPoints,
        });

        // إرسال تحديث قائمة اللاعبين مع النقاط للجميع
        io.to(pin).emit("update_players", room.players);
      }
    }
  });

  function sendQuestion(pin) {
    const room = rooms[pin];
    if (!room) return;

    if (room.currentQuestion >= room.selectedQuestions.length) {
      room.isPlaying = false;
      io.to(pin).emit("show_results", { players: room.players });
      return;
    }

    // تصفير بيانات الإجابة للسؤال الجديد
    room.answeredCount = 0;
    room.players.forEach((p) => {
      p.answerOrder = null;
      p.isCorrect = null;
      p.lastAddedPoints = 0;
    });
    io.to(pin).emit("update_players", room.players);

    const question = room.selectedQuestions[room.currentQuestion];
    let timeLeft = question.timeLimit || 15;

    io.to(pin).emit("new_question", {
      question,
      questionNumber: room.currentQuestion + 1,
      totalQuestions: room.selectedQuestions.length,
    });

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
      timeLeft--;
      io.to(pin).emit("timer_tick", timeLeft);

      if (timeLeft <= 0) {
        clearInterval(room.timer);
        room.currentQuestion++;
        sendQuestion(pin);
      }
    }, 1000);
  }
});

// استخدام المنفذ المخصص من الاستضافة السحابية أو 5000 كخيار احتياطي عند التشغيل المحلي
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`السيرفر يعمل بنجاح على المنفذ ${PORT} 🚀`);
});

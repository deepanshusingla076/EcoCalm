import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { connectDB, inMemoryDB, isUsingMongo } from "./config/db.js";
import { User, Plant, Quest, Story, Post, MoodLog, ChatMessage, Feedback } from "./models/Schemas.js";
import { dailyNatureFacts, initialPlant, initialAdmin } from "./data/seedData.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || "ecocalm_super_mindful_jwt_secret_2026";

// JWT Helper Functions
export const generateToken = (userData) => {
  return jwt.sign(
    {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role || "user"
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = decoded;
    next();
  });
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin privilege required" });
  }
  next();
};

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:3000",
  "http://localhost:5173"
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin) || origin.endsWith(".vercel.app") || origin.endsWith(".onrender.com") || process.env.NODE_ENV !== "production") {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(morgan("dev"));

// Connect DB
connectDB();

// ------------------- API ROUTES -------------------

// 1. Health Checks
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "EcoCalm Backend is running",
    database: isUsingMongo() ? "MongoDB Atlas (Active)" : "In-Memory Store (Active)",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    database: isUsingMongo() ? "MongoDB (Active)" : "In-Memory Store (Active)",
    timestamp: new Date().toISOString()
  });
});

// 2. Auth Routes with JWT & Role Support (user & admin)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userId = `user_${Date.now()}`;
    const cleanEmail = (email || `user${Date.now()}@ecocalm.app`).trim().toLowerCase();
    const isAdmin = cleanEmail === "hemal.au123@gmail.com";
    const userRole = isAdmin ? "admin" : "user";

    const newUser = {
      ...inMemoryDB.user,
      id: isAdmin ? "user_hemal_admin" : userId,
      name: isAdmin ? "Hemal (Admin)" : (name || "Mindful Soul"),
      email: cleanEmail,
      password: password || (isAdmin ? "hemal@admin" : "peaceful123"),
      role: userRole,
      waterDrops: isAdmin ? 999 : 50,
      offlineMinutesToday: isAdmin ? 120 : 0,
      questsCompletedToday: 0,
      mindfulnessSessionsCompleted: 0,
      calmStreakDays: 1,
      dailyAffirmation: isAdmin ? "Nurturing safe digital spaces for everyone." : "Your soft life starts here."
    };

    if (isUsingMongo()) {
      await User.create(newUser);
    }
    if (!inMemoryDB.users) inMemoryDB.users = [];
    inMemoryDB.users.push(newUser);
    inMemoryDB.user = newUser;

    const token = generateToken(newUser);
    res.status(201).json({ success: true, user: newUser, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email ? email.trim().toLowerCase() : "";

    // 1. Check if user is Hemal Admin
    if (cleanEmail === "hemal.au123@gmail.com") {
      if (password && password !== "hemal@admin") {
        return res.status(401).json({ error: "Invalid password for Hemal Admin account." });
      }

      let adminUser = null;
      if (isUsingMongo()) {
        adminUser = await User.findOne({ email: "hemal.au123@gmail.com" });
      }
      if (!adminUser) {
        adminUser = inMemoryDB.admin || (inMemoryDB.users && inMemoryDB.users.find(u => u.email === "hemal.au123@gmail.com")) || initialAdmin;
      }

      adminUser = {
        ...adminUser,
        role: "admin",
        email: "hemal.au123@gmail.com",
        name: adminUser.name || "Hemal (Admin)"
      };

      const token = generateToken(adminUser);
      return res.json({ success: true, user: adminUser, token });
    }

    // 2. Normal Visitor Login
    let foundUser = null;
    if (isUsingMongo()) {
      foundUser = await User.findOne({ email: cleanEmail });
    }

    if (!foundUser && inMemoryDB.users) {
      foundUser = inMemoryDB.users.find(u => u.email?.toLowerCase() === cleanEmail);
    }

    // Default gentle demo user fallback
    if (!foundUser) {
      foundUser = inMemoryDB.user;
    }

    // Check user password
    if (password && foundUser.password && password !== foundUser.password && password !== "peaceful123") {
      return res.status(401).json({ error: "Invalid password. Use 'peaceful123' for gentle demo." });
    }

    // Normal users always get "user" role
    foundUser = {
      ...foundUser,
      role: "user"
    };

    const token = generateToken(foundUser);
    res.json({ success: true, user: foundUser, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      return res.json({
        ...inMemoryDB.user,
        id: decoded.id,
        email: decoded.email,
        name: decoded.name,
        role: decoded.role
      });
    }
  }

  res.json(inMemoryDB.user);
});

// ------------------- FEEDBACK ROUTES -------------------

// Public / Authenticated Feedback Submission
app.post("/api/feedback", async (req, res) => {
  try {
    const { experience, feeling, suggestions, userName, userEmail, userId } = req.body;

    if (!experience || !feeling) {
      return res.status(400).json({ error: "Experience and post-use feeling are required." });
    }

    const newFeedback = {
      id: `fb_${Date.now()}`,
      userId: userId || "visitor",
      userName: userName || "Mindful Visitor",
      userEmail: userEmail || "",
      experience,
      feeling,
      suggestions: suggestions || "",
      createdAt: new Date()
    };

    if (isUsingMongo()) {
      await Feedback.create(newFeedback);
    }

    if (!inMemoryDB.feedbacks) inMemoryDB.feedbacks = [];
    inMemoryDB.feedbacks.unshift(newFeedback);

    res.status(201).json({
      success: true,
      message: "Every single thought helps us grow. Thanks for being part of our journey! 🌿",
      feedback: newFeedback
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Get All Feedback & Analytics
app.get("/api/admin/feedback", async (req, res) => {
  try {
    let feedbacksList = [];
    if (isUsingMongo()) {
      feedbacksList = await Feedback.find().sort({ createdAt: -1 });
    }
    if (!feedbacksList || feedbacksList.length === 0) {
      feedbacksList = inMemoryDB.feedbacks || [];
    }

    const total = feedbacksList.length;
    const experienceCounts = {
      "Loved it 💚": 0,
      "It was good 🌼": 0,
      "It was okay 🌿": 0,
      "Needs improvement 🪴": 0
    };
    const feelingCounts = {
      "Calmer 🌱": 0,
      "More hopeful ☀️": 0,
      "About the same 🌿": 0,
      "Still overwhelmed 🌧️": 0
    };

    feedbacksList.forEach(f => {
      if (experienceCounts[f.experience] !== undefined) {
        experienceCounts[f.experience]++;
      }
      if (feelingCounts[f.feeling] !== undefined) {
        feelingCounts[f.feeling]++;
      }
    });

    const satisfiedCount = (experienceCounts["Loved it 💚"] || 0) + (experienceCounts["It was good 🌼"] || 0);
    const satisfactionRate = total > 0 ? Math.round((satisfiedCount / total) * 100) : 100;

    const positiveCalmCount = (feelingCounts["Calmer 🌱"] || 0) + (feelingCounts["More hopeful ☀️"] || 0);
    const calmRate = total > 0 ? Math.round((positiveCalmCount / total) * 100) : 100;

    res.json({
      success: true,
      feedbacks: feedbacksList,
      stats: {
        total,
        satisfactionRate,
        calmRate,
        experienceCounts,
        feelingCounts
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Delete Single Feedback
app.delete("/api/admin/feedback/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (isUsingMongo()) {
      await Feedback.findOneAndDelete({ id });
    }
    if (inMemoryDB.feedbacks) {
      inMemoryDB.feedbacks = inMemoryDB.feedbacks.filter(f => f.id !== id);
    }
    res.json({ success: true, message: "Feedback removed successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 3. User Profile & Settings
app.get("/api/user", async (req, res) => {
  try {
    if (isUsingMongo()) {
      const user = await User.findOne({ id: inMemoryDB.user.id || "user_maya" });
      return res.json(user || inMemoryDB.user);
    }
    res.json(inMemoryDB.user);
  } catch (err) {
    res.json(inMemoryDB.user);
  }
});

app.put("/api/user", async (req, res) => {
  try {
    const updates = req.body;
    if (isUsingMongo()) {
      const user = await User.findOneAndUpdate({ id: inMemoryDB.user.id || "user_maya" }, updates, { new: true, upsert: true });
      return res.json(user);
    }
    inMemoryDB.user = { ...inMemoryDB.user, ...updates };
    res.json(inMemoryDB.user);
  } catch (err) {
    inMemoryDB.user = { ...inMemoryDB.user, ...req.body };
    res.json(inMemoryDB.user);
  }
});

// 4. Plant Routes (Step 2: Virtual Plant & Customization)
app.get("/api/plant", async (req, res) => {
  try {
    if (isUsingMongo()) {
      const plant = await Plant.findOne({ id: "plant_01" });
      return res.json(plant || inMemoryDB.plant);
    }
    res.json(inMemoryDB.plant);
  } catch (err) {
    res.json(inMemoryDB.plant);
  }
});

// Water Plant
app.post("/api/plant/water", async (req, res) => {
  try {
    const dropsToUse = req.body.drops || 10;
    let plantData = inMemoryDB.plant;
    let userData = inMemoryDB.user;

    if (isUsingMongo()) {
      const mongoPlant = await Plant.findOne({ id: "plant_01" });
      const mongoUser = await User.findOne({ id: inMemoryDB.user.id || "user_maya" });
      if (mongoPlant) plantData = mongoPlant;
      if (mongoUser) userData = mongoUser;
    }

    const userDrops = Math.max(0, (userData.waterDrops || 142) - dropsToUse);
    const newTotal = (plantData.totalDropsPoured || 162) + dropsToUse;
    let newHydration = Math.min(100, (plantData.hydration || 78) + Math.round(dropsToUse * 1.5));
    let stage = plantData.stage;
    let stageTitle = plantData.stageTitle;

    if (newHydration >= 100 && stage < 5) {
      stage += 1;
      newHydration = 25;
      if (stage === 4) stageTitle = "Blooming Garden Canopy";
      if (stage === 5) stageTitle = "Ancient Botanical Grove";
    }

    const updatedFields = {
      totalDropsPoured: newTotal,
      hydration: newHydration,
      dropsNeededForNextBloom: Math.max(0, 100 - newHydration),
      stage,
      stageTitle,
      lastWatered: "Just now"
    };

    if (isUsingMongo()) {
      const updatedPlant = await Plant.findOneAndUpdate({ id: "plant_01" }, updatedFields, { new: true });
      const updatedUser = await User.findOneAndUpdate({ id: inMemoryDB.user.id || "user_maya" }, { waterDrops: userDrops }, { new: true });
      return res.json({ plant: updatedPlant, user: updatedUser, dropsUsed: dropsToUse });
    }

    inMemoryDB.plant = { ...inMemoryDB.plant, ...updatedFields };
    inMemoryDB.user.waterDrops = userDrops;
    res.json({ plant: inMemoryDB.plant, user: inMemoryDB.user, dropsUsed: dropsToUse });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customize Plant (Pot Color & Style, Flower Type, Insects & Companions)
app.put("/api/plant/customize", async (req, res) => {
  try {
    const { name, potStyle, flowerType, companion, companionName } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (potStyle) updates.potStyle = potStyle;
    if (flowerType) updates.flowerType = flowerType;
    if (companion) updates.companion = companion;
    if (companionName) updates.companionName = companionName;

    if (isUsingMongo()) {
      const updated = await Plant.findOneAndUpdate({ id: "plant_01" }, updates, { new: true });
      return res.json(updated);
    }
    inMemoryDB.plant = { ...inMemoryDB.plant, ...updates };
    res.json(inMemoryDB.plant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adopt Seedling (From Onboarding)
app.post("/api/plant/adopt", async (req, res) => {
  try {
    const { plantType, name, variety, intention, flowerType, potStyle } = req.body;
    const newPlantData = {
      ...inMemoryDB.plant,
      name: name || "My Gentle Companion",
      plantType: plantType || "monstera",
      variety: variety || "Monstera Deliciosa",
      tagline: intention || "Growing gently without pressure",
      flowerType: flowerType || "rose_bud",
      potStyle: potStyle || "ceramic_ribbed",
      stage: 1,
      stageTitle: "Tender Seedling",
      hydration: 60,
      totalDropsPoured: 25,
      dropsNeededForNextBloom: 40,
      lastWatered: "Just planted"
    };

    const newDrops = (inMemoryDB.user.waterDrops || 142) + 25; // Bonus welcome drops

    if (isUsingMongo()) {
      await Plant.findOneAndUpdate({ id: "plant_01" }, newPlantData, { upsert: true });
      await User.findOneAndUpdate({ id: inMemoryDB.user.id || "user_maya" }, { waterDrops: newDrops });
    }

    inMemoryDB.plant = newPlantData;
    inMemoryDB.user.waterDrops = newDrops;

    res.json({ plant: inMemoryDB.plant, user: inMemoryDB.user, welcomeBonus: 25 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Quest Routes (Step 5: Side Quests)
app.get("/api/quests", async (req, res) => {
  try {
    const { category, time, cost, setting, search } = req.query;
    let list = inMemoryDB.quests;

    if (isUsingMongo()) {
      list = await Quest.find({});
    }

    if (category && category !== "all") {
      list = list.filter(q => q.category === category);
    }
    if (time && time !== "Any") {
      list = list.filter(q => q.timeBucket === time);
    }
    if (cost && cost !== "Any") {
      list = list.filter(q => q.costBucket === cost);
    }
    if (setting && setting !== "Any") {
      list = list.filter(q => q.setting.toLowerCase() === setting.toLowerCase());
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(q => q.title.toLowerCase().includes(s) || q.description.toLowerCase().includes(s));
    }

    res.json(list);
  } catch (err) {
    res.json(inMemoryDB.quests);
  }
});

app.post("/api/quests/complete", async (req, res) => {
  try {
    const { questId } = req.body;
    let dropsEarned = 15;

    if (isUsingMongo()) {
      const q = await Quest.findOne({ id: questId });
      if (q) {
        q.completed = true;
        dropsEarned = q.dropsReward || 15;
        await q.save();
      }
      await User.findOneAndUpdate({ id: inMemoryDB.user.id || "user_maya" }, {
        $inc: { waterDrops: dropsEarned, offlineMinutesToday: 15, questsCompletedToday: 1 }
      });
      const updatedUser = await User.findOne({ id: inMemoryDB.user.id || "user_maya" });
      return res.json({ success: true, dropsEarned, user: updatedUser });
    }

    const quest = inMemoryDB.quests.find(q => q.id === questId);
    if (quest) {
      quest.completed = true;
      dropsEarned = quest.dropsReward || 15;
    }
    inMemoryDB.user.waterDrops += dropsEarned;
    inMemoryDB.user.offlineMinutesToday += 15;
    inMemoryDB.user.questsCompletedToday += 1;

    res.json({ success: true, dropsEarned, user: inMemoryDB.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/quests/favorite", async (req, res) => {
  try {
    const { questId } = req.body;
    const favs = inMemoryDB.user.favoriteQuests || [];
    let updated;
    if (favs.includes(questId)) {
      updated = favs.filter(id => id !== questId);
    } else {
      updated = [...favs, questId];
    }
    inMemoryDB.user.favoriteQuests = updated;
    if (isUsingMongo()) {
      await User.findOneAndUpdate({ id: inMemoryDB.user.id || "user_maya" }, { favoriteQuests: updated });
    }
    res.json({ favoriteQuests: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/quests/submit", async (req, res) => {
  try {
    const { title, description, category, duration, dropsReward } = req.body;
    const newQuest = {
      id: `quest_${Date.now()}`,
      title: title || "Quiet Discovery",
      description: description || "A peaceful offline moment.",
      category: category || "nature",
      categoryLabel: "Custom Quest ✨",
      duration: duration || "15 mins",
      timeBucket: "<15",
      cost: "Free",
      costBucket: "free",
      setting: "Indoor",
      dropsReward: Number(dropsReward) || 20,
      tag: "Community Submission",
      difficulty: "Beginner Friendly",
      completed: false
    };

    if (isUsingMongo()) {
      await Quest.create(newQuest);
    }
    inMemoryDB.quests.unshift(newQuest);
    inMemoryDB.user.waterDrops += 20;

    res.status(201).json({ success: true, quest: newQuest, user: inMemoryDB.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Stories & Positive News (Step 7: Plot Twist)
app.get("/api/stories", async (req, res) => {
  try {
    const { category } = req.query;
    let list = inMemoryDB.stories;

    if (isUsingMongo()) {
      list = await Story.find({});
    }

    if (category && category !== "all") {
      list = list.filter(s => s.category === category);
    }
    res.json(list);
  } catch (err) {
    res.json(inMemoryDB.stories);
  }
});

app.get("/api/facts", (req, res) => {
  res.json(dailyNatureFacts);
});

app.post("/api/stories/like", async (req, res) => {
  try {
    const { storyId } = req.body;
    let story = inMemoryDB.stories.find(s => s.id === storyId);

    if (isUsingMongo()) {
      const s = await Story.findOne({ id: storyId });
      if (s) {
        s.likes += 1;
        s.bookmarked = !s.bookmarked;
        await s.save();
        story = s;
      }
    } else if (story) {
      story.likes += 1;
      story.bookmarked = !story.bookmarked;
    }

    res.json(story || { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/stories/submit", async (req, res) => {
  try {
    const { title, summary, category, source } = req.body;
    const newStory = {
      id: `story_${Date.now()}`,
      title: title || "A gentle quiet victory",
      summary: summary || "Community members gather to plant fruit trees in suburban pocket park.",
      category: category || "healing",
      categoryLabel: "The World Is Healing 🌱",
      readTime: "2 min read",
      dropsReward: 25,
      source: source || "Local Restorative Circle",
      sourceUrl: "https://goodnewsnetwork.org",
      location: "Global Neighborhood",
      timeAgo: "Just now",
      image: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=800&q=80",
      likes: 1,
      bookmarked: false
    };

    if (isUsingMongo()) {
      await Story.create(newStory);
    }
    inMemoryDB.stories.unshift(newStory);
    inMemoryDB.user.waterDrops += 25;

    res.status(201).json({ success: true, story: newStory, user: inMemoryDB.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Community & Hobbyverse (Step 9)
app.get("/api/community", async (req, res) => {
  try {
    const { circle } = req.query;
    let list = inMemoryDB.posts.filter(p => !p.isReported);

    if (isUsingMongo()) {
      list = await Post.find({ isReported: { $ne: true } });
    }

    if (circle && circle !== "all") {
      list = list.filter(p => p.circle === circle);
    }
    res.json(list);
  } catch (err) {
    res.json(inMemoryDB.posts);
  }
});

app.post("/api/community/join", async (req, res) => {
  try {
    const { circleId } = req.body;
    const joined = inMemoryDB.user.joinedCircles || [];
    let updated;
    if (joined.includes(circleId)) {
      updated = joined.filter(c => c !== circleId);
    } else {
      updated = [...joined, circleId];
    }
    inMemoryDB.user.joinedCircles = updated;
    if (isUsingMongo()) {
      await User.findOneAndUpdate({ id: inMemoryDB.user.id || "user_maya" }, { joinedCircles: updated });
    }
    res.json({ joinedCircles: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/community/chat", async (req, res) => {
  const { circle } = req.query;
  const msgs = inMemoryDB.chatMessages.filter(m => !circle || m.circle === circle);
  res.json(msgs);
});

app.post("/api/community/chat", async (req, res) => {
  try {
    const { circle, text } = req.body;
    const msg = {
      id: `chat_${Date.now()}`,
      circle: circle || "crochet",
      author: inMemoryDB.user.name || "Maya Chen",
      authorAvatar: inMemoryDB.user.avatar,
      text: text || "Hello community!",
      timestamp: new Date().toISOString()
    };
    if (isUsingMongo()) {
      await ChatMessage.create(msg);
    }
    inMemoryDB.chatMessages.push(msg);
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/community/post", async (req, res) => {
  try {
    const { title, text, circle, tags, image } = req.body;
    const circleMap = {
      crochet: "Crochet & Chill",
      books: "Bookworms' Corner",
      art: "The Delulu Artists Club",
      chess: "Chess Not Stress",
      plants: "The Green Thumb Gang",
      bake: "Bake It Till You Make It",
      craft: "DIY & Craft Society"
    };

    const newPost = {
      id: `post_${Date.now()}`,
      author: inMemoryDB.user.name || "Maya Chen",
      authorRole: inMemoryDB.user.tagline || "Gentle Pacer",
      authorAvatar: inMemoryDB.user.avatar,
      timeAgo: "Just now",
      circle: circle || "crochet",
      circleName: circleMap[circle] || "Crochet & Chill",
      title: title || "Making with unhurried hands",
      text: text || "Enjoying the process without rushing to the finish line.",
      tags: tags || ["#UnfinishedAndLoved", "#MindfulMaking"],
      image: image || "https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?auto=format&fit=crop&w=800&q=80",
      dropsGiven: 1,
      hasGivenDrop: false,
      isReported: false,
      comments: []
    };

    if (isUsingMongo()) {
      await Post.create(newPost);
    }
    inMemoryDB.posts.unshift(newPost);
    inMemoryDB.user.waterDrops += 15;

    res.status(201).json({ success: true, post: newPost, user: inMemoryDB.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/community/drops", async (req, res) => {
  try {
    const { postId } = req.body;
    let post = inMemoryDB.posts.find(p => p.id === postId);

    if (isUsingMongo()) {
      const p = await Post.findOne({ id: postId });
      if (p) {
        p.dropsGiven += 1;
        p.hasGivenDrop = true;
        await p.save();
        post = p;
      }
    } else if (post) {
      post.dropsGiven += 1;
      post.hasGivenDrop = true;
    }

    res.json(post || { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/community/comment", async (req, res) => {
  try {
    const { postId, text } = req.body;
    const newComment = {
      id: `c_${Date.now()}`,
      author: inMemoryDB.user.name || "Maya Chen",
      text: text || "Sending gentle warmth your way! 🌿"
    };

    let post = inMemoryDB.posts.find(p => p.id === postId);

    if (isUsingMongo()) {
      const p = await Post.findOne({ id: postId });
      if (p) {
        p.comments.push(newComment);
        await p.save();
        post = p;
      }
    } else if (post) {
      post.comments.push(newComment);
    }

    res.json({ success: true, comment: newComment, post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/community/report", (req, res) => {
  const { postId } = req.body;
  const post = inMemoryDB.posts.find(p => p.id === postId);
  if (post) post.isReported = true;
  res.json({ success: true, message: "Thank you for looking out for our peaceful community. Post reported for moderator review." });
});

// 8. Vibe Check & Emotional Tracking (Step 3 & Step 8)
app.get("/api/mood", async (req, res) => {
  try {
    if (isUsingMongo()) {
      const logs = await MoodLog.find({}).sort({ createdAt: -1 });
      return res.json(logs);
    }
    res.json(inMemoryDB.moodLogs);
  } catch (err) {
    res.json(inMemoryDB.moodLogs);
  }
});

app.post("/api/mood", async (req, res) => {
  try {
    const { score, emotion, emotionsList, intensity, note, checkinType, linkedActivity } = req.body;
    const moodMap = {
      0: "0 / 10 • Completely Calm",
      1: "1 / 10 • Deep Serenity",
      2: "2 / 10 • Relaxed Floating",
      3: "3 / 10 • Gentle Ease",
      4: "4 / 10 • Focused Flow",
      5: "5 / 10 • Mild Screen Buzz",
      6: "6 / 10 • Restless Energy",
      7: "7 / 10 • Overstimulated",
      8: "8 / 10 • High Tension",
      9: "9 / 10 • Sensory Clutter",
      10: "10 / 10 • Extremely Anxious & Overwhelmed"
    };

    const newLog = {
      id: `m_${Date.now()}`,
      userId: inMemoryDB.user.id || "user_maya",
      score: Number(score) !== undefined ? Number(score) : 3,
      emotion: emotion || "Calm",
      emotionsList: emotionsList && emotionsList.length ? emotionsList : [emotion || "Calm"],
      intensity: Number(intensity) || 5,
      emotionEmoji: req.body.emotionEmoji || "😌",
      label: moodMap[score] || `${score} / 10`,
      note: note || "Mindful check-in completed.",
      checkinType: checkinType || "general",
      linkedActivity: linkedActivity || null,
      timestamp: new Date().toISOString()
    };

    if (isUsingMongo()) {
      await MoodLog.create(newLog);
    }
    inMemoryDB.moodLogs.unshift(newLog);
    inMemoryDB.user.waterDrops += 10;

    res.status(201).json({ success: true, mood: newLog, user: inMemoryDB.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete mood history (Privacy option)
app.delete("/api/mood", async (req, res) => {
  inMemoryDB.moodLogs = [];
  if (isUsingMongo()) {
    await MoodLog.deleteMany({});
  }
  res.json({ success: true, message: "Emotional check-in history cleared privately." });
});

// 9. Mindfulness Breathing Completion (Step 4)
app.post("/api/breathe/complete", async (req, res) => {
  try {
    const { minutes, pattern } = req.body;
    const dropsEarned = 20;

    inMemoryDB.user.waterDrops += dropsEarned;
    inMemoryDB.user.offlineMinutesToday += (Number(minutes) || 3);
    inMemoryDB.user.mindfulnessSessionsCompleted += 1;

    if (isUsingMongo()) {
      await User.findOneAndUpdate({ id: inMemoryDB.user.id || "user_maya" }, {
        $inc: { waterDrops: dropsEarned, offlineMinutesToday: Number(minutes) || 3, mindfulnessSessionsCompleted: 1 }
      });
    }

    res.json({
      success: true,
      dropsEarned,
      message: "You showed up for yourself. That counts. 🌱",
      user: inMemoryDB.user
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌸 EcoCalm backend running on 0.0.0.0:${PORT}`);
  });
}

export default app;

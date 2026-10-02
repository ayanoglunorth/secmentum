require("dotenv").config({ quiet: true });

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const assessmentConfig = require("./assessment.config.json");

const PORT = process.env.PORT || 2500;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const ACCESS_CODE = process.env.ACCESS_CODE || "DEMO-ACCESS";
const publicDir = path.join(__dirname, "public");
const uploadTempDir = path.join(__dirname, "uploads", "tmp");
const stages = assessmentConfig.stages.map(({ questions, ...stage }) => ({ ...stage, questions: questions.length }));

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production");
if (process.env.NODE_ENV === "production" && !process.env.ACCESS_CODE) throw new Error("ACCESS_CODE is required in production");
fs.mkdirSync(uploadTempDir, { recursive: true });

function isR2Configured() {
  return Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}

function createR2Client() {
  return new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
}

function getStage(id) {
  return assessmentConfig.stages.find((stage) => stage.id === id);
}

function getStageStatuses(completedStages) {
  const completed = new Set(completedStages);
  const nextPending = completedStages.length + 1;
  return stages.map((stage) => ({
    ...stage,
    status: completed.has(stage.id) ? "Completed" : stage.id === nextPending ? "Pending" : "Locked",
  }));
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, message: "Unauthorized" });
  next();
}

function requireAuthPage(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function ensureAssessmentState(req) {
  if (!req.session.assessment) {
    req.session.assessment = { completedStages: [], activeStage: null, stageStartAt: null, stageResults: [] };
  }
  return req.session.assessment;
}

function validateVideoFile(file) {
  if (file.mimetype !== "video/webm") {
    const error = new Error("Only WebM video is accepted");
    error.code = "INVALID_VIDEO_TYPE";
    throw error;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const error = new Error("Video exceeds the 256 MB limit");
    error.code = "LIMIT_FILE_SIZE";
    throw error;
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadTempDir),
  filename: (_req, _file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}.webm`),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
  fileFilter: (_req, file, callback) => {
    try {
      validateVideoFile(file);
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  },
});

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(self), microphone=(self)" });
  next();
});
app.use(express.urlencoded({ extended: false, limit: "256kb" }));
app.use(express.json({ limit: "256kb" }));
app.use(session({
  name: "secmentum.sid",
  secret: process.env.SESSION_SECRET || "development-only-session-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 6, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
}));
app.use("/css", express.static(path.join(publicDir, "css")));
app.use("/js", express.static(path.join(publicDir, "js")));

app.get("/", (_req, res) => res.redirect("/login"));
app.get("/login", (_req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/dashboard", requireAuthPage, (_req, res) => res.sendFile(path.join(publicDir, "dashboard.html")));
app.get("/assessment-completed", requireAuthPage, (_req, res) => res.sendFile(path.join(publicDir, "assessment-completed.html")));
app.get("/test/:stage", requireAuthPage, (req, res) => {
  const stageId = Number(req.params.stage);
  if (!Number.isInteger(stageId) || !getStage(stageId)) return res.redirect("/dashboard");
  return res.sendFile(path.join(publicDir, "test.html"));
});

app.get("/api/config", (_req, res) => res.json({ brand: assessmentConfig.brand, storageEnabled: isR2Configured() }));

app.post("/api/login", (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim();
  const accessCode = String(req.body.accessCode || "").trim();
  if (!fullName || fullName.length > 100 || !email || email.length > 254) {
    return res.status(400).json({ success: false, message: "Valid name and email are required" });
  }
  if (accessCode.length > 64 || accessCode.toUpperCase() !== ACCESS_CODE.toUpperCase()) {
    return res.status(401).json({ success: false, message: "Invalid access code" });
  }
  req.session.user = { fullName, email, candidateId: crypto.randomUUID() };
  req.session.assessment = { completedStages: [], activeStage: null, stageStartAt: null, stageResults: [] };
  return res.json({ success: true, redirectTo: "/dashboard" });
});

app.post("/api/logout", requireAuth, (req, res) => req.session.destroy(() => res.json({ success: true })));

app.get("/api/dashboard", requireAuth, (req, res) => {
  const assessment = ensureAssessmentState(req);
  res.json({
    success: true,
    user: req.session.user,
    instructions: ["Complete the stages in order.", "Each stage has a time limit and submits automatically.", "Camera and microphone recording requires your consent.", "Stay in fullscreen and keep this tab active."],
    stages: getStageStatuses(assessment.completedStages),
    totalMinutes: stages.reduce((sum, stage) => sum + stage.durationMinutes, 0),
    storageEnabled: isR2Configured(),
  });
});

app.get("/api/stages/:id/questions", requireAuth, (req, res) => {
  const stageId = Number(req.params.id);
  const stage = getStage(stageId);
  if (!Number.isInteger(stageId) || !stage) return res.status(400).json({ success: false, message: "Invalid stage" });
  const assessment = ensureAssessmentState(req);
  if (stageId !== assessment.completedStages.length + 1 && assessment.activeStage !== stageId) {
    return res.status(409).json({ success: false, message: "Stage is not available" });
  }
  return res.json({ success: true, questions: stage.questions });
});

app.post("/api/stage/start", requireAuth, (req, res) => {
  const stageId = Number(req.body.stage);
  const assessment = ensureAssessmentState(req);
  if (!Number.isInteger(stageId) || !getStage(stageId)) return res.status(400).json({ success: false, message: "Invalid stage" });
  if (assessment.completedStages.includes(stageId)) return res.status(409).json({ success: false, message: "Stage already completed" });
  if (stageId !== assessment.completedStages.length + 1) return res.status(409).json({ success: false, message: "Complete stages in order" });
  assessment.activeStage = stageId;
  assessment.stageStartAt = Date.now();
  return res.json({ success: true, startedAt: assessment.stageStartAt });
});

app.post("/api/stage/complete", requireAuth, (req, res) => {
  const stageId = Number(req.body.stage);
  const assessment = ensureAssessmentState(req);
  if (!Number.isInteger(stageId) || !getStage(stageId)) return res.status(400).json({ success: false, message: "Invalid stage" });
  if (assessment.activeStage !== stageId) return res.status(409).json({ success: false, message: "Stage is not active" });
  assessment.completedStages.push(stageId);
  assessment.stageResults.push({ stageId, completedAt: Date.now(), answered: Number(req.body.score || 0), durationMs: Number(req.body.durationMs || 0) });
  assessment.activeStage = null;
  assessment.stageStartAt = null;
  return res.json({ success: true, completedStages: assessment.completedStages, stages: getStageStatuses(assessment.completedStages) });
});

app.post("/api/upload", requireAuth, upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Video is required" });
  validateVideoFile(req.file);
  if (!isR2Configured()) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, skipped: true });
  }
  const stage = Number(req.body.stage || 0);
  if (!Number.isInteger(stage) || !getStage(stage)) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ success: false, message: "Invalid stage" });
  }
  const objectKey = `recordings/${req.session.user.candidateId}/${Date.now()}-stage-${stage}.webm`;
  try {
    await createR2Client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: objectKey, Body: fs.createReadStream(req.file.path), ContentType: "video/webm", Metadata: { stage: String(stage) } }));
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, key: objectKey });
  } catch {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(500).json({ success: false, message: "Video upload failed" });
  }
});

app.post("/api/upload-answers", requireAuth, async (req, res) => {
  const stage = Number(req.body.stage || 0);
  const content = String(req.body.content || "");
  const assessment = ensureAssessmentState(req);
  if (!Number.isInteger(stage) || !getStage(stage)) return res.status(400).json({ success: false, message: "Invalid stage" });
  if (assessment.activeStage !== stage || !content.trim() || content.length > 128000) return res.status(400).json({ success: false, message: "Invalid answer report" });
  if (!isR2Configured()) return res.json({ success: true, skipped: true });
  const objectKey = `answers/${req.session.user.candidateId}/${Date.now()}-stage-${stage}.txt`;
  try {
    await createR2Client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: objectKey, Body: content, ContentType: "text/plain; charset=utf-8", Metadata: { stage: String(stage) } }));
    return res.json({ success: true, key: objectKey });
  } catch {
    return res.status(500).json({ success: false, message: "Answer upload failed" });
  }
});

app.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ success: false, message: "Video exceeds the 256 MB limit" });
  if (error?.code === "INVALID_VIDEO_TYPE") return res.status(415).json({ success: false, message: "Only WebM video is accepted" });
  return res.status(500).json({ success: false, message: "Request failed" });
});

if (require.main === module) app.listen(PORT, () => console.log(`Secmentum running at http://localhost:${PORT}`));

module.exports = { app, MAX_UPLOAD_BYTES, validateVideoFile };

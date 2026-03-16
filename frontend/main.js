const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

let mainWindow;
let clawdServer = null;

// Start clawd-cursor server for desktop mode
async function startClawdCursor() {
  try {
    const { Agent } = require("clawd-cursor/dist/agent");
    const { createServer } = require("clawd-cursor/dist/server");
    const { DEFAULT_CONFIG } = require("clawd-cursor/dist/types");

    const config = {
      ...DEFAULT_CONFIG,
      server: { ...DEFAULT_CONFIG.server, port: 3847 },
      ai: {
        ...DEFAULT_CONFIG.ai,
        apiKey: process.env.GEMINI_API_KEY || process.env.AI_API_KEY || "",
        provider: "gemini",
      },
    };

    const agent = new Agent(config);
    await agent.connect();

    const expressApp = createServer(agent, config);
    clawdServer = expressApp.listen(3847, "127.0.0.1", () => {
      console.log("🐾 Gemini Cursor running on http://127.0.0.1:3847");
    });

    return true;
  } catch (err) {
    console.error("Failed to start Gemini Cursor:", err.message);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    backgroundColor: "#0a0a0f",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Window control IPC handlers
  ipcMain.on("window-minimize", () => mainWindow?.minimize());
  ipcMain.on("window-maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on("window-close", () => mainWindow?.close());
}

app.whenReady().then(async () => {
  // Start clawd-cursor in background
  startClawdCursor();
  createWindow();
});

app.on("window-all-closed", () => {
  if (clawdServer) clawdServer.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

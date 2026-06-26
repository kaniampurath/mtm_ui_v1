import { ensureAuthenticated } from "./auth.js?v=20260531b";
import { createWorkspace } from "./workspace.js?v=20260626a";

ensureAuthenticated(document.getElementById("app"), (session) => createWorkspace(document.getElementById("app"), session));













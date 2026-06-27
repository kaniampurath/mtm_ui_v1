import { ensureAuthenticated } from "./auth.js?v=20260531b";
import { createWorkspace } from "./workspace.js?v=20260627b";

ensureAuthenticated(document.getElementById("app"), (session) => createWorkspace(document.getElementById("app"), session));















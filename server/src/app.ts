import express from "express";
import cors from "cors";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use(healthRouter);
app.use(authRouter);
app.use(projectsRouter);

app.use(errorHandler);

export default app;

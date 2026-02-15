import express from "express";
import cors from "cors";
import healthRouter from "./routes/health.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use(healthRouter);

app.use(errorHandler);

export default app;

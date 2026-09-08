import "dotenv/config";
import { createApp } from "./src/app.js";
import { connectDB } from "./src/config/db.js";

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    const app = createApp();
    app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });

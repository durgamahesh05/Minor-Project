import dns from "dns";
import mongoose from "mongoose";

// Some Windows/network setups can't resolve mongodb+srv:// SRV records via
// the default system DNS servers (querySrv ECONNREFUSED). Google's DNS
// reliably supports them, so use it just for this process's lookups.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
  }
  await mongoose.connect(uri);
  console.log("MongoDB connected");
}

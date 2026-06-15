// Configuración de la API. La clave se lee, por orden de prioridad, de:
//   1. variable de entorno API_FOOTBALL_KEY
//   2. archivo api-key.txt en la raíz del proyecto (una sola línea con la clave)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readKey() {
  if (process.env.API_FOOTBALL_KEY) return process.env.API_FOOTBALL_KEY.trim();
  const file = path.join(__dirname, "api-key.txt");
  if (fs.existsSync(file)) {
    const k = fs.readFileSync(file, "utf8").trim();
    if (k) return k;
  }
  return null;
}

export const API_KEY = readKey();
export const API_HOST = "v3.football.api-sports.io";

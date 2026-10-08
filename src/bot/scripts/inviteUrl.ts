import "dotenv/config";
import { OAuth2Scopes, PermissionsBitField } from "discord.js";
import { REQUIRED_PERMISSIONS } from "../client.js";

const clientId = process.env["CLIENT_ID"];
if (!clientId) {
  console.error("CLIENT_ID manquant dans .env");
  process.exit(1);
}
const permissions = new PermissionsBitField([...REQUIRED_PERMISSIONS]).bitfield;
const url = new URL("https://discord.com/oauth2/authorize");
url.searchParams.set("client_id", clientId);
url.searchParams.set("scope", [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(" "));
url.searchParams.set("permissions", permissions.toString());
console.log(`Permissions (${permissions}) : ${REQUIRED_PERMISSIONS.join(", ")}`);
console.log(url.toString());

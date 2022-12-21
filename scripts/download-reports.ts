import { authenticate } from "@google-cloud/local-auth";
import "dotenv/config";
import { google } from "googleapis";
import fs from "node:fs";
import { join } from "node:path";
import child_process from "node:child_process";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

let auth: Awaited<ReturnType<typeof authenticate>>;

const getAuth = async () =>
  (auth ??= await authenticate({
    keyfilePath: join(process.cwd(), "credentials.json"),
    scopes: SCOPES,
  }));

const REPORTS_FOLDER = join(process.cwd(), "reports");

const getSheet = async () => {
  const auth = await getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.REPORTS_SHEET_ID!,
    range: "Sheet2",
  });
  return data.values;
};

const download = async () => {
  const sheet = await getSheet();
  const rows = sheet.slice(1);
  const groups = rows.reduce((acc, row) => {
    const [key, ...rest] = row;
    acc[key] = [...(acc[key] ?? []), rest];
    return { ...acc };
  }, {} as Record<string, string[][]>);
  for (const [key, rows] of Object.entries(groups)) {
    const content = rows.map((row) => row.join("\n")).join("\n\n");
    const path = join(REPORTS_FOLDER, `${key}.txt`);
    fs.writeFileSync(path, content);
    console.log(`Downloaded ${key} to ${path}`);
  }
};

download();

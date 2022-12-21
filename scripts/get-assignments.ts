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

const SUBMISSIONS_FOLDER = join(process.cwd(), "assignment-2-submissions");

const getFilesAndCreateFolders = async () => {
  const auth = await getAuth();
  const drive = google.drive({ version: "v3", auth });
  // get files with owner name
  const { data } = await drive.files.list({
    q: `'${process.env.A2_FOLDER_ID}' in parents`,
    pageSize: 1000,
    fields: "files(id, name, webViewLink, owners, modifiedTime)",
  });

  // create folders for each owner
  const owners = new Set(data.files.map((file) => file.owners[0].displayName));
  for (const owner of owners) {
    const folder = join(SUBMISSIONS_FOLDER, owner);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(join(SUBMISSIONS_FOLDER, owner));
    }
  }

  // if same file name exists, keep the newer one in the list
  for (let i = 0; i < data.files.length; i++) {
    const file1 = data.files[i];
    for (let j = i + 1; j < data.files.length; j++) {
      const file2 = data.files[j];
      if (file1.name === file2.name) {
        if (new Date(file1.modifiedTime) > new Date(file2.modifiedTime)) {
          data.files.splice(j, 1);
        } else {
          data.files.splice(i, 1);
        }
      }
    }
  }

  let count = 0;

  for (const file of data.files) {
    console.log(`[${++count} / ${data.files.length}]`);
    const owner = file.owners[0].displayName;
    const folder = join(SUBMISSIONS_FOLDER, owner);
    const filePath = join(folder, file.name);
    if (fs.existsSync(filePath)) {
      console.log(`Skipping ${file.name} because it already exists.`);
      continue;
    }
    // download file
    try {
      const { data } = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "stream" }
      );
      const writer = fs.createWriteStream(filePath);
      data
        .on("end", () => {})
        .on("error", (err) => {
          console.error("Error downloading file.");
          console.error(err);
        })
        .pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      console.log(`Done writing ${file.name}`);
    } catch (err) {
      console.error("Error downloading file:", file.name, owner);
    }
  }
};

const unzipFiles = async () => {
  // get folders in SUBMISSIONS_FOLDER
  const folders = fs
    .readdirSync(SUBMISSIONS_FOLDER)
    .filter((file) =>
      fs.lstatSync(join(SUBMISSIONS_FOLDER, file)).isDirectory()
    )
    .map((folder) => join(SUBMISSIONS_FOLDER, folder));
  let count = 0;
  for (const folder of folders) {
    console.log(`[${++count} / ${folders.length}] ${folder.split("/").pop()}`);
    const files = fs.readdirSync(folder);
    for (const file of files) {
      const filePath = join(folder, file);
      if (filePath.endsWith(".zip")) {
        console.log(`Unzipping ${filePath}`);
        child_process.execSync(`unzip "${filePath}" -d "${folder}"`);
        fs.unlinkSync(filePath);
      } else if (filePath.endsWith(".rar")) {
        console.log(`Unrar-ing ${filePath}`);
        child_process.execSync(`unrar x "${filePath}" "${folder}"`);
        fs.unlinkSync(filePath);
      }
    }
    // loop through files in folder again and if there is only one folder, move all files in that folder to the parent folder
    const filesInFolder = fs.readdirSync(folder);
    if (
      filesInFolder.length === 1 &&
      fs.lstatSync(join(folder, filesInFolder[0])).isDirectory()
    ) {
      console.log("Extracting files from folder and deleting folder...");
      const onlyFolder = join(folder, filesInFolder[0]);
      const filesInOnlyFolder = fs.readdirSync(onlyFolder);
      for (const file of filesInOnlyFolder) {
        fs.renameSync(join(onlyFolder, file), join(folder, file));
      }
      fs.rmdirSync(onlyFolder);
    }
  }
};

unzipFiles();

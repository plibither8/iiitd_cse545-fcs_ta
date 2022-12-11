import { authenticate } from "@google-cloud/local-auth";
import "dotenv/config";
import { google } from "googleapis";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groups, groupMemberMap } from "./group-distribution";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

let auth: Awaited<ReturnType<typeof authenticate>>;

const getAuth = async () =>
  (auth ??= await authenticate({
    keyfilePath: join(process.cwd(), "credentials.json"),
    scopes: SCOPES,
  }));

const createForms = async () => {
  const auth = await getAuth();
  const forms = google.forms({
    version: "v1",
    auth,
  });

  // Create a new form
  for (const group of groups) {
    const title = `Report issue - Group ${group}`;
    const form = await forms.forms.create({
      requestBody: {
        info: {
          title,
          documentTitle: `FCS: ${title}`,
        },
      },
    });
    console.log(`Group ${group}: ${form.data.responderUri}`);
  }
};

const listFormsInDrive = async () => {
  const auth = await getAuth();
  const drive = google.drive({
    version: "v3",
    auth,
  });

  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.form'",
    fields: "files(id, name, webViewLink, webContentLink)",
  });
  const fcsForms = response.data.files?.filter(
    (file) => file.name?.startsWith("FCS: ") ?? undefined
  );

  return fcsForms;
};

const updateForms = async () => {
  const fields: {
    title: string;
    description: string;
  }[] = [
    {
      title: "Vulnerabilty type",
      description: "Select the type of vulnerability, or specify a custom one.",
    },
    {
      title: "Steps to reproduce",
      description: "Describe the steps to reproduce the vulnerability.",
    },
    {
      title: "Proof of concept",
      description: "Provide a proof of concept for the vulnerability.",
    },
    {
      title: "Impact",
      description: "Describe the impact of the vulnerability. How bad is it?",
    },
    {
      title: "Screenshots/attachments",
      description:
        "Provide screenshots or other attachments to help explain the vulnerability.",
    },
  ];

  auth ??= await getAuth();
  const forms = google.forms({
    version: "v1",
    auth,
  });
  const files = await listFormsInDrive();
  console.log(files);

  for (const file of files.slice(0, 1)) {
    const title = file.name?.replace("FCS: ", "") ?? "";
    const group = file.name?.split("Group ")[1];
    const form = await forms.forms.batchUpdate({
      formId: file.id,
      requestBody: {
        includeFormInResponse: true,
        requests: [
          {
            updateFormInfo: {
              info: {
                title,
                description: `Please fill out this form to report an issue/vulnerability in the group ${group}.`,
              },
              updateMask: "description",
            },
          },
          ...fields.map(({ title, description }, index) => ({
            createItem: {
              item: { title, description, textItem: {} },
              location: { index },
            },
          })),
        ],
      },
    });
    console.log(`Updated Group ${group}:`, form.data.form);
  }
};

const duplicateAndUpdateForms = async () => {
  auth ??= await getAuth();
  const drive = google.drive({ version: "v3", auth });
  const forms = google.forms({ version: "v1", auth });

  for (const group of groups) {
    const title = `Report issue - Group ${group}`;
    const { data: file } = await drive.files.copy({
      fileId: process.env.BASE_FORM_FILE_ID!,
      requestBody: {
        name: `FCS: ${title}`,
        parents: [process.env.PARENT_FOLDER_ID!],
      },
    });
    console.log(`Copied form for Group ${group}:`, file.id);
    await forms.forms.batchUpdate({
      formId: file.id,
      requestBody: {
        includeFormInResponse: true,
        requests: [
          {
            updateFormInfo: {
              info: {
                title,
                description: `Please fill out this form to report an issue/vulnerability in the group ${group}.`,
              },
              updateMask: "*",
            },
          },
        ],
      },
    });
    console.log(`Updated form for Group ${group}:`, file.id);
  }
};

const addStatusColumnToResponseSheets = async () => {
  auth ??= await getAuth();
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  const { data: files } = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet'",
    fields: "files(id, name)",
  });
  const responseSheets = files.files?.filter((file) =>
    file.name?.startsWith("FCS: Report issue")
  );

  const values = [["Status", "Comments"]];
  for (const sheet of responseSheets) {
    const { data: sheetData } = await sheets.spreadsheets.get({
      spreadsheetId: sheet.id!,
      fields: "sheets.properties.sheetId",
    });
    const sheetId = sheetData.sheets?.[0].properties?.sheetId!;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheet.id!,
      range: `'Form Responses 1'!H1:I1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
    console.log(`Added status sheet to ${sheet.name}`);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheet.id!,
      requestBody: {
        requests: [
          {
            setDataValidation: {
              range: {
                sheetId,
                startRowIndex: 1,
                endRowIndex: 1000,
                startColumnIndex: 7,
                endColumnIndex: 8,
              },
              rule: {
                condition: {
                  type: "ONE_OF_LIST",
                  values: [
                    { userEnteredValue: "Pending" },
                    { userEnteredValue: "Valid" },
                    { userEnteredValue: "Invalid" },
                  ],
                },
                inputMessage: "Please select a valid status.",
                strict: true,
              },
            },
          },
        ],
      },
    });
    console.log(`Added status validation to ${sheet.name}`);
  }
};

interface GroupAndForm {
  group: number;
  driveLink: string;
  form: string;
  responses: string;
}

const saveGroupsAndForms = async () => {
  auth ??= await getAuth();
  const drive = google.drive({ version: "v3", auth });
  const forms = google.forms({ version: "v1", auth });

  const { data: files } = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.form'",
    fields: "files(id, name, webViewLink, webContentLink)",
  });

  const formFiles = files.files?.filter((file) =>
    file.name?.startsWith("FCS: Report issue")
  );

  const groupsAndForms: GroupAndForm[] = [];
  for (const file of formFiles) {
    console.log(file.name);
    const group = Number(file.name?.split("Group ")[1]);
    const form = await forms.forms.get({ formId: file.id! });
    groupsAndForms.push({
      group,
      driveLink: file.webViewLink,
      form: form.data.responderUri,
      responses: `https://docs.google.com/spreadsheets/d/${form.data.linkedSheetId}/edit#gid=0`,
    });
  }
  groupsAndForms.sort((a, b) => a.group - b.group);
  writeFileSync(
    "./groups-and-forms.json",
    JSON.stringify(groupsAndForms, null, 2)
  );
};

const getGroupsAndForms = (): GroupAndForm[] => {
  const data = readFileSync("./groups-and-forms.json", "utf-8");
  return JSON.parse(data) as GroupAndForm[];
};

const openFormSettings = async () => {
  const formFiles = getGroupsAndForms();
  for (const file of formFiles) {
    const link = file.driveLink.split("?")[0] + "#settings";
    console.log(link);
  }
};

const protectResponseSheets = async () => {
  auth ??= await getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const groupsAndForms = getGroupsAndForms();
  for (const { responses } of groupsAndForms) {
    const id = responses.split("/d/")[1].split("/")[0];
    const { data: sheetData } = await sheets.spreadsheets.get({
      spreadsheetId: id,
      fields: "sheets.properties.sheetId",
    });
    const sheetId = sheetData.sheets?.[0].properties?.sheetId!;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          {
            addProtectedRange: {
              protectedRange: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1000,
                  startColumnIndex: 0,
                  endColumnIndex: 7,
                },
                description: "Responses",
                warningOnly: false,
                editors: {
                  users: process.env.EDITOR_EMAILS!.split(","),
                },
              },
            },
          },
          {
            addProtectedRange: {
              protectedRange: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 9,
                },
                description: "Headers",
                warningOnly: false,
                editors: {
                  users: process.env.EDITOR_EMAILS!.split(","),
                },
              },
            },
          },
        ],
      },
    });
    console.log(`Protected sheet ${id}`);
  }
};

const addBordersAndFormatHeaders = async () => {
  auth ??= await getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const groupsAndForms = getGroupsAndForms();
  for (const { responses } of groupsAndForms) {
    const id = responses.split("/d/")[1].split("/")[0];
    const { data: sheetData } = await sheets.spreadsheets.get({
      spreadsheetId: id,
      fields: "sheets.properties.sheetId",
    });
    const border = {
      style: "SOLID",
      width: 1,
      color: {
        red: 0.8,
        green: 0.8,
        blue: 0.8,
      },
    };
    const sheetId = sheetData.sheets?.[0].properties?.sheetId!;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          {
            updateBorders: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1000,
                startColumnIndex: 0,
                endColumnIndex: 9,
              },
              top: border,
              bottom: border,
              left: border,
              right: border,
              innerHorizontal: border,
              innerVertical: border,
            },
          },
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 9,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: true,
                  },
                },
              },
              fields: "userEnteredFormat(textFormat)",
            },
          },
        ],
      },
    });
    console.log(`Added borders to sheet ${id}`);
  }
};

const shareResponseSheetsWithGroups = async () => {
  auth ??= await getAuth();
  const drive = google.drive({ version: "v3", auth });
  const groupsAndForms = getGroupsAndForms();
  for (const { group, responses } of groupsAndForms) {
    console.log(`Sharing sheet for group ${group}`);
    const id = responses.split("/d/")[1].split("/")[0];
    const emails = groupMemberMap[group];
    for (const email of emails) {
      await drive.permissions.create({
        fileId: id,
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress: email.trim(),
        },
      });
      console.log(`Shared with ${email}`);
    }
    console.log();
  }
};

const unshareResponseSheetsWithGroups = async () => {
  auth ??= await getAuth();
  const drive = google.drive({ version: "v3", auth });
  const groupsAndForms = getGroupsAndForms();
  for (const { group, responses } of groupsAndForms) {
    console.log(`Unsharing sheet for group ${group}`);
    const fileId = responses.split("/d/")[1].split("/")[0];
    const emails = groupMemberMap[group];
    const {
      data: { permissions },
    } = await drive.permissions.list({
      fileId,
      fields: "permissions(id,emailAddress)",
    });
    for (const email of emails) {
      const permission = permissions.find(
        (p) => p.emailAddress === email.trim()
      );
      if (permission) {
        await drive.permissions.delete({
          fileId,
          permissionId: permission.id!,
        });
        console.log(`Unshared with ${email}`);
      }
    }
  }
};

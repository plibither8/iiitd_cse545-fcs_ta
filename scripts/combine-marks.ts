import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const prisma = new PrismaClient();

async function putMarks() {
  const students = ``.split("\n").map((x) => x.trim());
  const marks = ``.split("\n").map((x) => parseFloat(x));
  for (let i = 0; i < students.length; i++) {
    await prisma.marks.upsert({
      where: { email: students[i] },
      create: {
        email: students[i],
        testing: marks[i],
      },
      update: {
        testing: marks[i],
      },
    });
    console.log("Updated", students[i]);
  }
}

async function dropLate() {
  const lateDropped = ``.split("\n").map((x) => x.trim());
  for (let i = 0; i < lateDropped.length; i++) {
    await prisma.marks.delete({
      where: { email: lateDropped[i] },
    });
    console.log("Deleted", lateDropped[i]);
  }
}

async function createCsv() {
  const data = await prisma.marks.findMany();
  const csv = data
    .map((x) =>
      [
        x.email,
        x.assignment1,
        x.assignment2,
        x.quizzes,
        x.midsem,
        x.endsem,
        Number(x.october) + Number(x.november),
        x.testing,
      ].join(",")
    )
    .join("\n");
  fs.writeFileSync("./assets/marks.csv", csv);
}

// putMarks();
// dropLate();
createCsv();

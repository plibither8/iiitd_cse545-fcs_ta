import { readFileSync, writeFileSync } from "node:fs";

const sheet = readFileSync("sheet.txt", "utf8");

export const groupMemberMap: { [key: number]: string[] } = sheet
  .split("\n")
  .map((row) => row.trim())
  .reduce((acc, row) => {
    const [group, ...members] = row.split("\t");
    acc[Number(group)] = members;
    return acc;
  }, {});

export const memberGroupMap: {
  [key: string]: number;
} = sheet
  .split("\n")
  .map((row) => row.trim())
  .map((row) => row.split("\t"))
  .flatMap(([group, ...members]) => members.map((member) => [member, group]))
  .reduce(
    (acc, [member, group]) => ({
      ...acc,
      [member]: Number(group),
    }),
    {}
  );

export const groups = [...new Set(Object.values(memberGroupMap))];
export const students = Object.keys(memberGroupMap);

const main = async () => {
  const assignmentsPerStudent = 5;
  const totalAssignments = assignmentsPerStudent * students.length;
  const groupsCount = groups.length;
  const averageAssignmentsPerGroup = totalAssignments / groupsCount;
  const minAssignmentsPerGroup = Math.floor(averageAssignmentsPerGroup);
  const maxAssignmentsPerGroup = Math.ceil(averageAssignmentsPerGroup);
  const x =
    (totalAssignments - groupsCount * maxAssignmentsPerGroup) /
    (minAssignmentsPerGroup - maxAssignmentsPerGroup);

  const xGroups = groups
    .slice(0, x)
    .flatMap((group) =>
      Array.from({ length: minAssignmentsPerGroup }, () => group)
    );
  const yGroups = groups
    .slice(x)
    .flatMap((group) =>
      Array.from({ length: maxAssignmentsPerGroup }, () => group)
    );
  const groupsWithAssignments = [...xGroups, ...yGroups];

  const assignments: {
    [key: string]: number[];
  } = {};

  students.forEach((student) => {
    const group = memberGroupMap[student];
    assignments[student] = [];
    while (assignments[student].length < assignmentsPerStudent) {
      const randomIndex = Math.floor(
        Math.random() * groupsWithAssignments.length
      );
      const assignment = groupsWithAssignments[randomIndex] as number;
      if (assignment !== group && !assignments[student].includes(assignment)) {
        assignments[student].push(assignment);
        groupsWithAssignments.splice(randomIndex, 1);
      }
    }
    assignments[student].sort((a, b) => a - b);
  });

  console.log(assignments);

  const csv = [
    [
      "Student",
      "Own group",
      "Group 1",
      "Group 2",
      "Group 3",
      "Group 4",
      "Group 5",
    ].join(","),
    ...Object.entries(assignments).map(([student, groups]) =>
      [student, memberGroupMap[student], ...groups].join(",")
    ),
  ].join("\n");

  writeFileSync("fcs-groups-to-test.csv", csv, "utf8");
};

// src/lib/demo/types.ts
//
// サンプルデータの形（型のみ）。ランタイムの値は一切持たない。`import type` でのみ
// 参照される想定のため、appStore.ts 等がこのファイルを型として参照してもデータ本体
// （dataset.ts）はバンドルに含まれない（TypeScript の型消去・Section 19対応）。

import type {
  Member, Project, Task, Objective, KeyResult, TaskForce, ToDo, TaskDependency, Milestone,
} from "../localData/types";

export interface DemoDataset {
  members: Member[];
  projects: Project[];
  tasks: Task[];
  objectives: Objective[];
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  todos: ToDo[];
  taskDependencies: TaskDependency[];
  milestones: Milestone[];
}

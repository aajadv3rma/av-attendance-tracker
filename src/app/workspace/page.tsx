import type { Metadata } from "next";
import WorkspaceClient from "@/components/workspace/WorkspaceClient";

export const metadata: Metadata = {
  title: "Your workspace",
  description: "Your private AV Attendance Tracker workspace.",
};

export default function WorkspacePage() {
  return <WorkspaceClient />;
}

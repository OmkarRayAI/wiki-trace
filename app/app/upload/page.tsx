import { redirect } from "next/navigation";

export default function UploadRedirect() {
  redirect("/playground?tab=upload");
}

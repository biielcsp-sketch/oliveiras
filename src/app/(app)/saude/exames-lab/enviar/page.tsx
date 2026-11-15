import { getAppContext } from "@/lib/data";
import { UploadFlow } from "../../_components/labs/upload-flow";

export const metadata = { title: "Enviar exames · Saúde" };

export default async function Page() {
  const ctx = await getAppContext();
  const people = ctx.members.map((m) => ({ id: m.id, name: m.name }));
  return <UploadFlow people={people} defaultMember={ctx.me?.id ?? people[0]?.id ?? ""} />;
}

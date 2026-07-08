import { redirect } from "next/navigation";

// The app has two pages — Classification and Risk Score. Home opens on Classification.
export default function Home() {
  redirect("/classification");
}

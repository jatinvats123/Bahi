import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="after-margin pt-16 pb-16">
      <h1 className="text-[34px] leading-tight font-medium text-ink">Ye panna khata mein nahi hai.</h1>
      <p className="mt-2 text-[15px] text-ink-soft">Link galat ho sakta hai.</p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
        Command par wapas
      </Link>
    </div>
  );
}

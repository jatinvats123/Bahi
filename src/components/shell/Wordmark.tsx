import { APP_NAME, WORDMARK_HI } from "@/lib/brand";

export function Wordmark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-baseline gap-2" role="img" aria-label={APP_NAME}>
      <span aria-hidden className={`font-serif font-semibold tracking-tight text-cloth-ink ${lg ? "text-[30px] leading-none" : "text-[21px] leading-none"}`}>
        {APP_NAME}
      </span>
      <span aria-hidden className={`font-deva text-cloth-stitch ${lg ? "text-[22px]" : "text-[17px]"}`}>
        {WORDMARK_HI}
      </span>
    </span>
  );
}

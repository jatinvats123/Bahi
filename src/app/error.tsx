"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isConfig = error.name === "EnvError" || error.message.includes(".env.local");

  return (
    <div className="after-margin pt-16 pb-16">
      <h1 className="text-[34px] leading-tight font-medium text-ink">Kuch gadbad ho gayi.</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] text-ink-soft">
        {isConfig
          ? "Setup mein dikkat hai. .env.local check karo; details terminal mein hain."
          : "Page load nahi hua. Dobara koshish karo; details terminal aur Activity mein milengi."}
      </p>
      {error.digest ? <p className="num mt-3 text-[12px] text-ink-faint-text">ref {error.digest}</p> : null}
      <Button variant="primary" className="mt-6" onClick={retry}>
        Dobara koshish karo
      </Button>
    </div>
  );
}

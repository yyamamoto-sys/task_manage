// src/hooks/useTypingEffect.ts
// AI返答をタイプライター風に1文字ずつ表示するフック。

import { useState, useEffect, useRef } from "react";

export function useTypingEffect(text: string, speed = 14): { displayed: string; done: boolean } {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const prevRef = useRef("");

  useEffect(() => {
    if (text === prevRef.current) return;
    prevRef.current = text;
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  return { displayed, done };
}

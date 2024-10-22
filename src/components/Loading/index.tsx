import { CSSProperties, useEffect, useMemo } from "react";
import "./index.css";

interface LoadingProps<T> {
  on?: boolean;
  /** default is `"blue"` */
  theme?: "dark" | "gray" | "blue" | "yellow" | "green" | "purple" | "red";
  /** 16 bit color, will override theme */
  color?: T extends `#${infer U}` ? U : never;
  disableHeartBit?: boolean;
  m?: CSSProperties["margin"];
  mt?: CSSProperties["marginTop"];
  mr?: CSSProperties["marginRight"];
  mb?: CSSProperties["marginBottom"];
  ml?: CSSProperties["marginLeft"];
  mx?: CSSProperties["marginInline"];
  my?: CSSProperties["marginBlock"];
  p?: CSSProperties["padding"];
  pt?: CSSProperties["paddingTop"];
  pr?: CSSProperties["paddingRight"];
  pb?: CSSProperties["paddingBottom"];
  pl?: CSSProperties["paddingLeft"];
  px?: CSSProperties["paddingInline"];
  py?: CSSProperties["paddingBlock"];
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

const LoadColor = {
  dark: "#000000",
  gray: "#666666",
  blue: "#2196f3",
  yellow: "#ffeb3b",
  green: "#3b9b3e",
  purple: "#00008f",
  red: "#f44336",
};

export function Loading<T>({ on, theme, color, disableHeartBit, ...props }: LoadingProps<T>) {
  useEffect(() => {
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("color must be 16 bit color");
  }, []);
  const loadColor = useMemo(() => color || LoadColor[theme ?? "blue"], [color, theme]);
  const loadColor2 = useMemo(() => loadColor + "81", [loadColor]);
  return on ? (
    <div
      className="evp-loading"
      style={{
        // @ts-ignore
        "--loading-color": `${loadColor}`,
        "--loading-color2": `${loadColor2}`,
        margin: props.m,
        marginTop: props.mt,
        marginRight: props.mr,
        marginBottom: props.mb,
        marginLeft: props.ml,
        marginInline: props.mx,
        marginBlock: props.my,
        padding: props.p,
        paddingTop: props.pt,
        paddingRight: props.pr,
        paddingBottom: props.pb,
        paddingLeft: props.pl,
        paddingInline: props.px,
        paddingBlock: props.py,
      }}
    >
      <div style={{ animationPlayState: disableHeartBit ? "paused" : "running" }} />
      <div />
      <div />
      <div />
    </div>
  ) : null;
}

export default Loading;

import { Heading } from "@chakra-ui/react";

export default function Update(props: { v: string; published_at: string }) {
  const publishedDate = new Date(props.published_at);
  const now = new Date();
  const timeDifference = now.getTime() - publishedDate.getTime();
  const daysDifference = Math.floor(timeDifference / (1000 * 60 * 60 * 24));

  const formattedDate = publishedDate
    .toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    })
    .replace("星期", ", 周");

  const formattedTime = publishedDate.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const timeAgo = () => {
    const seconds = Math.floor(timeDifference / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}天前`;
    } else if (hours > 0) {
      return `${hours}小时前`;
    } else if (minutes > 0) {
      return `${minutes}分钟前`;
    } else {
      return `${seconds}秒前`;
    }
  };

  return (
    <>
      <Heading fontSize="xl" textAlign="center" mb="1rem" aria-label="有最新版本可用">
        {"有最新版本可用"}
      </Heading>
      <p>
        <span>最新版本：</span>
        <span>{props.v}</span>
        <span>
          （{formattedDate}
          {daysDifference <= 3 && ` ${formattedTime}`}
          {`, ${timeAgo()}`}）
        </span>
      </p>
    </>
  );
}

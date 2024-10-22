import { Box, Heading, Link } from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-shell";
import packageJson from "~/package.json";

export const infoText = `${packageJson.info.appname}
版本：${packageJson.version}
开发者：${packageJson.info.author.name} (${packageJson.info.author.email[0]})
发行日期：${new Date(packageJson.info.date).toLocaleDateString()}
Tauri：${packageJson.dependencies["@tauri-apps/api"].replace("^", "")}
Vite：${packageJson.devDependencies.vite.replace("^", "")}
React：${packageJson.dependencies.react.replace("^", "")}
版权所有 © ${new Date().getFullYear()} ${packageJson.info.author.name}`;

export default function About() {
  return (
    <Box>
      <Heading fontSize="xl" textAlign="center" mb="1rem" aria-label="应用名称">
        {packageJson.info.appname}
      </Heading>
      <p>
        <span>版本：</span>
        <span>{packageJson.version}</span>
      </p>
      <p>
        <span>开发者：</span>
        <span>
          {packageJson.info.author.name}
          <Link
            rel="noopener noreferrer"
            color="blue.500"
            href={"mailto:".concat(packageJson.info.author.email[0])}
            onClick={(e) => {
              e.preventDefault();
              open("mailto:".concat(packageJson.info.author.email[0]));
            }}
          >
            {` (${packageJson.info.author.email[0]}) `}
          </Link>
        </span>
      </p>
      <p>
        <span>发行时间：</span>
        <span>{new Date(packageJson.info.date).toLocaleDateString()}</span>
      </p>
      <p>
        <span>Tauri：</span>
        <span>{packageJson.dependencies["@tauri-apps/api"].replace("^", "")}</span>
      </p>
      <p>
        <span>Vite：</span>
        <span>{packageJson.devDependencies["vite"].replace("^", "")}</span>
      </p>
      <p>
        <span>React：</span>
        <span>{packageJson.dependencies["react"].replace("^", "")}</span>
      </p>
      <p>
        <span aria-label="版权所有">
          版权所有 © {new Date().getFullYear()} {packageJson.info.author.name}
        </span>
      </p>
    </Box>
  );
}

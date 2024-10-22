import { Flex, Icon } from "@chakra-ui/react";

export default function TitleBarDots(props: { title?: string }) {
  return (
    <Flex ml="1em" align="center" data-tauri-drag-region>
      <Icon viewBox="0 0 200 200" color="red.500" data-tauri-drag-region>
        <path
          fill="currentColor"
          d="M 100, 100 m -75, 0 a 75,75 0 1,0 150,0 a 75,75 0 1,0 -150,0"
          data-tauri-drag-region
        />
      </Icon>
      <Icon viewBox="0 0 200 200" color="yellow.400" data-tauri-drag-region>
        <path
          fill="currentColor"
          d="M 100, 100 m -75, 0 a 75,75 0 1,0 150,0 a 75,75 0 1,0 -150,0"
          data-tauri-drag-region
        />
      </Icon>
      <Icon viewBox="0 0 200 200" color="green.300" data-tauri-drag-region>
        <path
          fill="currentColor"
          d="M 100, 100 m -75, 0 a 75,75 0 1,0 150,0 a 75,75 0 1,0 -150,0"
          data-tauri-drag-region
        />
      </Icon>
      {props.title && (
        <h1 style={{ marginLeft: "0.5rem", fontSize: "small" }} data-tauri-drag-region>
          {props.title}
        </h1>
      )}
    </Flex>
  );
}

import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
} from "@chakra-ui/react";
import { ReactNode, useRef, useState } from "react";
import packageJson from "~/package.json";

export default function useDialog(options?: {
  varient?: "danger" | "warning" | "primary" | "success";
  content?: ReactNode;
  canCelProps?: {
    onClick?: () => void;
    label?: string;
    isDisabled?: boolean;
    hidden?: boolean;
  };
  confirmProps?: {
    onClick?: () => void;
    label: string;
    isDisabled?: boolean;
    hidden?: boolean;
  };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const cancelRef = useRef(null);
  const close = () => setIsOpen(false);
  const open = () => setIsOpen(true);

  const onCancel = options?.canCelProps?.onClick || (() => setIsOpen(false));
  const onConfirm = options?.confirmProps?.onClick || (() => setIsOpen(false));

  const confirmSchema = {
    danger: "red",
    warning: "yellow",
    primary: "blue",
    success: "green",
  }[options?.varient || "primary"];

  const Dialog = () => (
    <AlertDialog
      onClose={close}
      isOpen={isOpen}
      leastDestructiveRef={cancelRef}
      motionPreset="slideInBottom"
      isCentered
    >
      <AlertDialogOverlay />
      <AlertDialogContent>
        <AlertDialogHeader fontSize="sm">{packageJson.info.appname}</AlertDialogHeader>
        <AlertDialogCloseButton />
        <AlertDialogBody>{options?.content}</AlertDialogBody>
        <AlertDialogFooter>
          <Button ref={cancelRef} onClick={onCancel} size="sm" hidden={options?.canCelProps?.hidden}>
            {options?.canCelProps?.label || "取消"}
          </Button>
          <Button
            colorScheme={confirmSchema}
            ml={3}
            onClick={onConfirm}
            size="sm"
            hidden={options?.confirmProps?.hidden}
          >
            {options?.confirmProps?.label || "确认"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { isOpen, close, open, Render: Dialog };
}

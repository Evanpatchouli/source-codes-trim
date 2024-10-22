import { CheckCircleIcon, InfoIcon, WarningIcon } from "@chakra-ui/icons";
import {
  IconProps,
  PlacementWithLogical,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
  Tooltip,
  TypographyProps,
  useDisclosure,
} from "@chakra-ui/react";
import { ErrorIcon } from "react-hot-toast";

export type TipProps = {
  variant?: "info" | "warning" | "error" | "success";
  component?: "tooltip" | "popover";
  content: React.ReactNode;
  "aria-label": string;
  size?: TypographyProps["fontSize"];
  title?: string;
  placement?: PlacementWithLogical;
  footer?: (close: () => void) => React.ReactNode;
  layerTheme?: "light" | "dark";
} & IconProps;

const tooltipTheme = {
  light: {
    colors: {
      background: "#101010",
      text: "#fff",
    },
  },
  dark: {
    colors: {
      background: "#fff",
      text: "#101010",
    },
  },
};

const popoverTheme = {
  light: {
    colors: {
      background: "#fff",
      borderColor: "#f0f0f0",
      text: "#101010",
    },
  },
  dark: {
    colors: {
      background: "#101010",
      borderColor: "#101010",
      text: "#fff",
    },
  },
};

const IconFC = {
  info: (props: any) => <InfoIcon color="blue.400" {...props} />,
  warning: (props: any) => <WarningIcon color="orange.500" {...props} />,
  error: (props: any) => <ErrorIcon color="red.500" {...props} />,
  success: (props: any) => <CheckCircleIcon color="green.500" {...props} />,
};

export default function Tip(props: TipProps) {
  const {
    variant = "info",
    component = "tooltip",
    content,
    placement = "auto",
    size = "sm",
    title,
    footer,
    layerTheme = "light",
    ...iconProps
  } = props;
  const { isOpen, onClose, onOpen } = useDisclosure();

  if (component === "tooltip") {
    return (
      <Tooltip
        label={content}
        aria-label={props["aria-label"]}
        fontSize={size}
        placement={placement}
        title={title}
        isOpen={isOpen}
        onOpen={onOpen}
        onClose={onClose}
        bgColor={tooltipTheme[layerTheme].colors.background}
        color={tooltipTheme[layerTheme].colors.text}
        hasArrow
      >
        {IconFC[variant]({ fontSize: size, ...iconProps })}
      </Tooltip>
    );
  }

  return (
    <Popover trigger="hover" placement={placement} isOpen={isOpen} onOpen={onOpen} onClose={onClose}>
      <PopoverTrigger>{IconFC[variant]({ fontSize: size, ...iconProps })}</PopoverTrigger>
      <PopoverContent
        bgColor={popoverTheme[layerTheme].colors.background}
        color={popoverTheme[layerTheme].colors.text}
        borderColor={popoverTheme[layerTheme].colors.borderColor}
      >
        <PopoverArrow bgColor={popoverTheme[layerTheme].colors.background} />
        {title && (
          <>
            <PopoverCloseButton />
            <PopoverHeader
              bgColor={popoverTheme[layerTheme].colors.background}
              color={popoverTheme[layerTheme].colors.text}
              borderColor={popoverTheme[layerTheme].colors.background}
              borderTopColor={popoverTheme[layerTheme].colors.borderColor}
              fontSize="sm"
            >
              {title}
            </PopoverHeader>
          </>
        )}
        <PopoverBody
          bgColor={popoverTheme[layerTheme].colors.background}
          color={popoverTheme[layerTheme].colors.text}
          borderColor={popoverTheme[layerTheme].colors.background}
          borderLeftColor={popoverTheme[layerTheme].colors.borderColor}
          borderRightColor={popoverTheme[layerTheme].colors.borderColor}
          fontSize="sm"
        >
          {content}
        </PopoverBody>
        {typeof footer === "function" && (
          <PopoverFooter
            display="flex"
            justifyContent="flex-end"
            bgColor={popoverTheme[layerTheme].colors.background}
            color={popoverTheme[layerTheme].colors.text}
            borderColor={popoverTheme[layerTheme].colors.background}
            borderBottomColor={popoverTheme[layerTheme].colors.borderColor}
            fontSize="sm"
          >
            {footer(onClose)}
          </PopoverFooter>
        )}
      </PopoverContent>
    </Popover>
  );
}

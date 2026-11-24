import { useState, type FormEvent } from "react";
import {
  Button, Flex, FormControl, FormLabel, Input, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalFooter, ModalHeader, ModalOverlay, Radio, RadioGroup, Text,
} from "@chakra-ui/react";
import { parseLineSelection, type LineSelection } from "../utils/lineSelection";

interface LineExportProps {
  total: number;
  exporting: boolean;
  onExport: (selection: LineSelection) => Promise<{ ok: boolean; message: string } | undefined>;
  onClose: () => void;
}

export default function LineExport({ total, exporting, onExport, onClose }: LineExportProps) {
  const [mode, setMode] = useState<LineSelection["mode"]>(total ? "range" : "all");
  const [range, setRange] = useState({ first: "1", last: String(total) });
  const [headTail, setHeadTail] = useState({ first: "1", last: "1" });
  const [writeError, setWriteError] = useState("");
  const [values, setValues] = mode === "headTail" ? [headTail, setHeadTail] : [range, setRange];
  const parsed = parseLineSelection(mode, values.first, values.last, total);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (exporting || "error" in parsed) return;
    setWriteError("");
    const feedback = await onExport(parsed.selection);
    if (feedback?.ok) onClose();
    else if (feedback) setWriteError(feedback.message);
  }

  return (
    <Modal isOpen onClose={onClose} isCentered closeOnEsc={!exporting} closeOnOverlayClick={!exporting}>
      <ModalOverlay />
      <ModalContent as="form" onSubmit={submit} maxW="min(28rem, 94vw)">
        <ModalHeader>按行导出 TXT</ModalHeader>
        <ModalCloseButton aria-label="关闭按行导出" isDisabled={exporting} />
        <ModalBody>
          <RadioGroup
            aria-label="导出范围"
            value={mode}
            onChange={(value) => { setMode(value as LineSelection["mode"]); setWriteError(""); }}
          >
            <Flex gap={4} flexWrap="wrap">
              <Radio value="all" isDisabled={exporting}>全文</Radio>
              <Radio value="range" isDisabled={exporting || !total}>指定起止行</Radio>
              <Radio value="headTail" isDisabled={exporting || !total}>首尾行</Radio>
            </Flex>
          </RadioGroup>
          {mode !== "all" && (
            <Flex gap={3} mt={4}>
              {(["first", "last"] as const).map((key) => (
                <FormControl key={key} isDisabled={exporting}>
                  <FormLabel fontSize="sm" htmlFor={`export-line-${key}`}>
                    {mode === "headTail" ? (key === "first" ? "开头行数" : "结尾行数") : (key === "first" ? "起始行" : "结束行")}
                  </FormLabel>
                  <Input
                    size="sm" id={`export-line-${key}`} inputMode="numeric" value={values[key]}
                    onChange={(event) => {
                      setValues({ ...values, [key]: event.target.value });
                      setWriteError("");
                    }}
                  />
                </FormControl>
              ))}
            </Flex>
          )}
          {mode === "headTail" && <Text fontSize="sm" color="gray.600" mt={2}>首尾范围重叠时，每行只导出一次。</Text>}
          {"error" in parsed ? (
            <Text role="alert" fontSize="sm" color="red.600" mt={3}>{parsed.error}</Text>
          ) : (
            <Text role="status" fontSize="sm" mt={3}>将导出 {parsed.count} 行，全文共 {total} 行。</Text>
          )}
          {writeError && <Text role="alert" color="red.600" fontSize="sm" mt={2}>{writeError}</Text>}
        </ModalBody>
        <ModalFooter gap={2}>
          <Button size="sm" type="button" onClick={onClose} isDisabled={exporting}>取消</Button>
          <Button size="sm" type="submit" colorScheme="blue" isDisabled={exporting || "error" in parsed}>
            {exporting ? "正在导出…" : "选择保存位置"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

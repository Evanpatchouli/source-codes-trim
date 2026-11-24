import { useEffect, useMemo, useState } from "react";
import {
  Button, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter,
  ModalHeader, ModalOverlay, Text,
} from "@chakra-ui/react";
import { createFilePager, describeFileRange, type FilePageView } from "../utils/filePreview";

interface FileSnapshotProps {
  id: string;
  index: number;
  range: SourceFileRange;
  onClose: () => void;
}

export default function FileSnapshot({ id, index, range, onClose }: FileSnapshotProps) {
  const [page, setPage] = useState<FilePageView>({ status: "loading", number: 1 });
  const reader = useMemo(() => createFilePager(id, index, setPage), [id, index]);
  useEffect(() => {
    if (range.byteCount > 0) void reader.read();
    return reader.dispose;
  }, [reader, range.byteCount]);

  const multiplePages = page.number > 1 || (page.status === "loaded" && page.hasNext);
  return (
    <Modal isOpen onClose={onClose} size="3xl" isCentered scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent maxW="min(48rem, 94vw)">
        <ModalHeader>文件整理结果</ModalHeader>
        <ModalCloseButton aria-label="关闭文件整理结果" />
        <ModalBody>
          <Text fontSize="sm" fontWeight="semibold" overflowWrap="anywhere">{range.path}</Text>
          <Text fontSize="sm" color="gray.600" my={2}>
            {range.startLine === null ? "0 行" : `全文${describeFileRange(range)}`}
          </Text>
          {range.byteCount === 0 ? (
            <Text py={3}>此文件整理后为空。</Text>
          ) : page.status === "loading" ? (
            <Text role="status" py={3}>正在读取文件整理结果…</Text>
          ) : page.status === "error" ? (
            <Flex alignItems="center" gap={2}>
              <Text role="alert" color="red.600">读取失败：{page.message}</Text>
              <Button size="sm" onClick={reader.read}>重试</Button>
            </Flex>
          ) : (
            <pre className="file-snapshot-text" key={page.number} tabIndex={0}><code>{page.text}</code></pre>
          )}
        </ModalBody>
        <ModalFooter gap={2} flexWrap="wrap">
          {multiplePages && (
            <>
              <Text fontSize="sm" mr="auto">第 {page.number} 页</Text>
              <Button size="sm" onClick={reader.previous} isDisabled={page.number === 1}>上一页</Button>
              <Button size="sm" onClick={reader.next} isDisabled={page.status !== "loaded" || !page.hasNext}>下一页</Button>
            </>
          )}
          <Button size="sm" colorScheme="blue" onClick={onClose}>返回全文</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

import readStorageSnapshot from "#/utils/readStorageSnapshot";
import { Heading } from "@chakra-ui/react";

export default function Cache() {
  const storage = readStorageSnapshot(localStorage);
  return (
    <>
      <Heading fontSize="xl" textAlign="center" mb="1rem" aria-label="数据缓存">
        {"数据缓存"}
      </Heading>
      <pre
        style={{
          fontSize: "0.8rem",
        }}
      >
        {JSON.stringify(storage, null, 2)}
      </pre>
    </>
  );
}

// [
//   {
//       "path": "D:\\Work\\source-codes-trim\\src",
//       "name": "src",
//       "is_dir": true,
//       "children": [
//           {
//               "path": "D:\\Work\\source-codes-trim\\src\\App.tsx",
//               "name": "App.tsx",
//               "is_dir": false,
//               "children": []
//           },
//           {
//               "path": "D:\\Work\\source-codes-trim\\src\\components",
//               "name": "components",
//               "is_dir": true,
//               "children": [
//                   {
//                       "path": "D:\\Work\\source-codes-trim\\src\\components\\FileTree",
//                       "name": "FileTree",
//                       "is_dir": true,
//                       "children": [
//                           {
//                               "path": "D:\\Work\\source-codes-trim\\src\\components\\FileTree\\index.tsx",
//                               "name": "index.tsx",
//                               "is_dir": false,
//                               "children": []
//                           }
//                       ]
//                   }
//               ]
//           },
//           {
//               "path": "D:\\Work\\source-codes-trim\\src\\main.tsx",
//               "name": "main.tsx",
//               "is_dir": false,
//               "children": []
//           },
//           {
//               "path": "D:\\Work\\source-codes-trim\\src\\types",
//               "name": "types",
//               "is_dir": true,
//               "children": [
//                   {
//                       "path": "D:\\Work\\source-codes-trim\\src\\types\\index.d.ts",
//                       "name": "index.d.ts",
//                       "is_dir": false,
//                       "children": []
//                   },
//                   {
//                       "path": "D:\\Work\\source-codes-trim\\src\\types\\window.d.ts",
//                       "name": "window.d.ts",
//                       "is_dir": false,
//                       "children": []
//                   }
//               ]
//           },
//           {
//               "path": "D:\\Work\\source-codes-trim\\src\\utils",
//               "name": "utils",
//               "is_dir": true,
//               "children": [
//                   {
//                       "path": "D:\\Work\\source-codes-trim\\src\\utils\\classes.ts",
//                       "name": "classes.ts",
//                       "is_dir": false,
//                       "children": []
//                   },
//                   {
//                       "path": "D:\\Work\\source-codes-trim\\src\\utils\\flatternFileTree.ts",
//                       "name": "flatternFileTree.ts",
//                       "is_dir": false,
//                       "children": []
//                   },
//                   {
//                       "path": "D:\\Work\\source-codes-trim\\src\\utils\\invoke.ts",
//                       "name": "invoke.ts",
//                       "is_dir": false,
//                       "children": []
//                   }
//               ]
//           },
//           {
//               "path": "D:\\Work\\source-codes-trim\\src\\vite-env.d.ts",
//               "name": "vite-env.d.ts",
//               "is_dir": false,
//               "children": []
//           }
//       ]
//   },
//   {
//       "path": "D:\\Work\\source-codes-trim\\vite.config.ts",
//       "name": "vite.config.ts",
//       "is_dir": false,
//       "children": []
//   }
// ]
export default function flatternFileTree(tree: Array<FileItem>): FileItem[] {
  return tree.flatMap((item) => {
    if (item.is_dir && Array.isArray(item.children)) {
      return [item, ...flatternFileTree(item.children)];
    } else {
      return [item];
    }
  });
}
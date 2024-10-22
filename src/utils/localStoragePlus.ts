export class LocalStoragePlus<T extends object = Record<string, any>> {

  private isJSON(str: string): [boolean, any] {
    try {
      const result = JSON.parse(str);
      return [true, result];
    } catch (e) {
      return [false, void 0]
    }
  }

  setItem<K extends keyof T>(key: K, value: T[K]): void {
    const valueSet = typeof value === "string" ? value : JSON.stringify(value);
    localStorage.setItem(key as string, valueSet);
  }

  getItem<K extends keyof T>(key: K): T[K] | null {
    const item = localStorage.getItem(key as string);
    if (item) {
      const [isJson, result] = this.isJSON(item);
      if (isJson) {
        return result as T[K];
      }
    }
    return item as T[K];
  }

  removeItem<K extends keyof T>(key: K): void {
    localStorage.removeItem(key as string);
  }

  clear(): void {
    localStorage.clear();
  }

  key(index: number): string | null {
    return localStorage.key(index);
  }

  length(): number {
    return localStorage.length;
  }

  keys(): (keyof T)[] {
    const len = localStorage.length;
    return Array.from({ length: len }, (_, i) => localStorage.key(i) as keyof T).filter((key) => key !== null);
  }

  values(): T[keyof T][] {
    const keys = this.keys();
    return keys.map((key) => this.getItem(key as keyof T) as T[keyof T]);
  }

  entries(): [keyof T, T[keyof T]][] {
    return this.keys().map((key) => [key, this.getItem(key as keyof T) as T[keyof T]]);
  }

  has<K extends keyof T>(key: K): boolean {
    return this.keys().includes(key);
  }

  map<U>(callbackfn: (key: keyof T, value: T[keyof T]) => U): U[] {
    return this.entries().map(([key, value]) => callbackfn(key, value));
  }

  forEach(callbackfn: (key: keyof T, value: T[keyof T], index: number, array: [keyof T, T[keyof T]][]) => void): void {
    const entries = this.entries();
    entries.forEach(([key, value], index) => callbackfn(key, value, index, entries));
  }

  filter(callbackfn: (key: keyof T, value: T[keyof T], index: number, array: [keyof T, T[keyof T]][]) => boolean): [keyof T, T[keyof T]][] {
    const entries = this.entries();
    return entries.filter(([key, value], index) => callbackfn(key, value, index, entries));
  }

  reduce<U>(callbackfn: (accumulator: U, currentValue: [keyof T, T[keyof T]], currentIndex: number, array: [keyof T, T[keyof T]][]) => U, initialValue: U): U {
    const entries = this.entries();
    return entries.reduce((accumulator, [key, value], currentIndex) => {
      return callbackfn(accumulator, [key, value], currentIndex, entries);
    }, initialValue);
  }

  reduceRight<U>(callbackfn: (accumulator: U, currentValue: [keyof T, T[keyof T]], currentIndex: number, array: [keyof T, T[keyof T]][]) => U, initialValue?: U): U {
    const entries = this.entries();
    return entries.reduceRight((accumulator, [key, value], currentIndex) => {
      return callbackfn(accumulator, [key, value], currentIndex, entries);
    }, initialValue as U);
  }

  every(callbackfn: (value: [keyof T, T[keyof T]], index: number, array: [keyof T, T[keyof T]][]) => boolean): boolean {
    const entries = this.entries();
    return entries.every(([key, value], index) => {
      return callbackfn([key, value], index, entries);
    });
  }

  some(callbackfn: (value: [keyof T, T[keyof T]], index: number, array: [keyof T, T[keyof T]][]) => boolean): boolean {
    const entries = this.entries();
    return entries.some(([key, value], index) => {
      return callbackfn([key, value], index, entries);
    });
  }

  sort(compareFn?: (a: [keyof T, T[keyof T]], b: [keyof T, T[keyof T]]) => number): [keyof T, T[keyof T]][] {
    return this.entries().sort((a, b) => compareFn ? compareFn(a, b) : (a[0] > b[0] ? 1 : -1));
  }

  toObject(): T {
    return this.entries().reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {} as T);
  }
}

// 创建一个全局实例
const localStoragePlus = new LocalStoragePlus<Record<string, any> & {
  showLongtimeTip: boolean,
  "chakra-ui-color-mode": "light" | "dark",
}>();

// 将实例添加到全局对象
// (window as any).localStoragePlus = localStoragePlus;

export default localStoragePlus;
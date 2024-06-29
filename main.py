import random
import time
from collections import OrderedDict

CAPACITY = 20_000_000
WRITE_CYCLE_COUNT = 20_000
WRITE_INTERVAL = 0.1  # 100 milliseconds


class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.cache = OrderedDict()

    def get(self, key):
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

    def put(self, key, value):
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)


def main():
    cache = LRUCache(CAPACITY)

    while True:
        for _ in range(WRITE_CYCLE_COUNT):
            key = random.randint(0, 2**63 - 1)
            value = random.randint(0, 2**63 - 1)
            cache.put(key, value)
        time.sleep(WRITE_INTERVAL)


if __name__ == "__main__":
    main()

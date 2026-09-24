"""Lazy, reusable I/O resources with explicit shutdown."""
from concurrent.futures import ThreadPoolExecutor
from itertools import islice
from threading import Lock
from typing import Callable, Iterable, TypeVar

import httpx

T = TypeVar("T")
R = TypeVar("R")


class IOResources:
    def __init__(self, workers: int = 3):
        self._workers = max(1, workers)
        self._lock = Lock()
        self._client = None
        self._executor = None

    @property
    def http(self) -> httpx.Client:
        with self._lock:
            if self._client is None:
                self._client = httpx.Client(
                    timeout=45,
                    limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
                )
            return self._client

    def map(self, function: Callable[[T], R], items: Iterable[T]) -> list[R]:
        """Keep order and submit only one worker-sized batch at a time."""
        iterator = iter(items)
        results = []
        while batch := list(islice(iterator, self._workers)):
            with self._lock:
                if self._executor is None:
                    self._executor = ThreadPoolExecutor(max_workers=self._workers, thread_name_prefix="rag-io")
                futures = [self._executor.submit(function, item) for item in batch]
            try:
                results.extend(future.result() for future in futures)
            except Exception:
                for future in futures:
                    future.cancel()
                raise
        return results

    def close(self) -> None:
        with self._lock:
            executor, client = self._executor, self._client
            self._executor = self._client = None
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)
        if client is not None:
            client.close()


resources = IOResources()

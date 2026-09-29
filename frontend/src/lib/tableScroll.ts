// Scroll affordances for content tables wrapped by wrapContentTables().
//
// Sets these attributes on each .table-scroll wrapper, which global.css uses:
// - data-overflowing: the table is wider than its column (shows the hint)
// - data-more-left / data-more-right: fade that edge to show there is more
// - data-scrolled: the reader has scrolled once, so the hint can go
// Scrolling itself is plain CSS, so tables work before or without this.

function initTableScroll() {
    const wrappers = document.querySelectorAll<HTMLElement>('[data-table-scroll]');
    if (!wrappers.length) return;

    const controller = new AbortController();
    const { signal } = controller;

    const update = (wrapper: HTMLElement, viewport: HTMLElement) => {
        const max = viewport.scrollWidth - viewport.clientWidth;
        const left = Math.abs(viewport.scrollLeft);
        wrapper.toggleAttribute('data-overflowing', max > 1);
        wrapper.toggleAttribute('data-more-left', left > 1);
        wrapper.toggleAttribute('data-more-right', left < max - 1);
        if (left > 1) wrapper.setAttribute('data-scrolled', '');
    };

    const resize = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const viewport = entry.target as HTMLElement;
            update(viewport.parentElement as HTMLElement, viewport);
        }
    });

    for (const wrapper of wrappers) {
        const viewport = wrapper.querySelector<HTMLElement>('.table-scroll__viewport');
        if (!viewport) continue;
        let queued = false;
        viewport.addEventListener(
            'scroll',
            () => {
                if (queued) return;
                queued = true;
                requestAnimationFrame(() => {
                    queued = false;
                    update(wrapper, viewport);
                });
            },
            { passive: true, signal }
        );
        resize.observe(viewport);
        update(wrapper, viewport);
    }

    document.addEventListener(
        'astro:before-swap',
        () => {
            controller.abort();
            resize.disconnect();
        },
        { once: true }
    );
}

// astro:page-load fires on the first load and after every client navigation.
document.addEventListener('astro:page-load', initTableScroll);

export {};

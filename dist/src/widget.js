import { formatStatusText, formatWidgetLines } from "./render.js";
import { emitTaskState, TASK_WIDGET_ID, } from "./state-events.js";
export function updateTaskUi(pi, ctx, state, reason) {
    ctx.ui.setStatus(TASK_WIDGET_ID, formatStatusText(state));
    ctx.ui.setWidget(TASK_WIDGET_ID, formatWidgetLines(state), {
        placement: "aboveEditor",
    });
    emitTaskState(pi, state, reason);
}

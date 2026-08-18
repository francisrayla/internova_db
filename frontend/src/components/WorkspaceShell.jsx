"use client";

import { useState } from "react";
import Icon from "./Icon";

export function ActionButton({ onClick, icon, children, variant }) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      className={`action-button${variant === "secondary" ? " secondary" : ""}`}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

export function Stat({ label, value, note, tone }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className={tone}>{value}</strong>
      <span className="stat-note">{note}</span>
    </div>
  );
}

export function Panel({ title, subtitle, icon, tone = "mint", action, className = "", children }) {
  return (
    <div className={`panel role-panel ${className}`}>
      <div className="panel-heading">
        <div className="title-with-icon">
          {icon && (
            <span className={`section-icon ${tone}`}>
              <Icon name={icon} size={14} />
            </span>
          )}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </div>
  );
}

const WEEK_DAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function AttendanceCard({ interactive }) {
  const [clockedIn, setClockedIn] = useState(false);

  return (
    <div className="panel attendance-panel">
      <div className="panel-heading">
        <div className="title-with-icon">
          <span className="section-icon mint">
            <Icon name="location" size={14} />
          </span>
          <h2>Attendance</h2>
        </div>
      </div>
      <div className="attendance-content">
        <div className="hours-ring">
          <strong>96<span>%</span></strong>
          <small>this week</small>
        </div>
        <div className="attendance-days">
          <div className="legend">
            <span><i className="legend-present" /> Present</span>
            <span><i className="legend-late" /> Late</span>
            <span><i className="legend-missing" /> Missing</span>
          </div>
          <div className="week-bars">
            {WEEK_DAYS.map((day, i) => (
              <div className="day-bar" key={`${day}-${i}`}>
                <div className={`bar bar-${i + 1}`} />
                <span>{day}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {interactive && (
        <button className={`attendance-button${clockedIn ? " clocked" : ""}`} onClick={() => setClockedIn((v) => !v)}>
          <span className="attendance-pulse" />
          {clockedIn ? "Clocked in · Tap to clock out" : "Clock in with GPS + Selfie"}
          <Icon name="camera" size={14} />
        </button>
      )}
    </div>
  );
}

const COLUMNS = [
  { key: "pending", label: "Pending", dot: "#e8ac60" },
  { key: "ongoing", label: "Ongoing", dot: "#4c9edb" },
  { key: "done", label: "Done", dot: "#5ba17d" },
];

export function TaskBoard({ initialTasks = [], canManage }) {
  const [tasks] = useState(initialTasks);

  return (
    <div className="kanban role-kanban">
      <div className="kanban-header">
        <span>Task board</span>
        {canManage && (
          <button className="add-task" aria-label="Add task">
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t) => t.status === col.key);
        return (
          <div className="kanban-column" key={col.key}>
            <div className="column-title">
              <span className="column-dot" style={{ background: col.dot }} />
              <span>{col.label}</span>
              <span className="column-count">{columnTasks.length}</span>
            </div>
            {columnTasks.map((task) => (
              <div className="task-card role-task-card" key={task.id}>
                <div className="task-card-top">
                  <span className="task-label">{task.label}</span>
                  <span className={`task-priority`}>{task.priority}</span>
                </div>
                <h3>{task.title}</h3>
                <div className="task-meta">
                  <span><span className={`task-dot ${task.priority?.toLowerCase()}`} /> Due {task.due}</span>
                  <span className="avatar small">{task.owner}</span>
                </div>
                <div className="task-counts">
                  {task.doneSubtasks}/{task.subtasks} subtasks · {task.files} files · {task.comments} comments
                </div>
              </div>
            ))}
            {columnTasks.length === 0 && <p className="task-label">No tasks</p>}
          </div>
        );
      })}
    </div>
  );
}

export function EvaluationCard({ canEdit }) {
  return (
    <div className="panel evaluation-panel">
      <div className="panel-heading">
        <div className="title-with-icon">
          <span className="section-icon lilac">
            <Icon name="spark" size={14} />
          </span>
          <h2>Latest evaluation</h2>
        </div>
        <span className="score-badge">92%</span>
      </div>
      {canEdit ? (
        <div className="evaluation-table">
          <label>Communication <select defaultValue="5"><option>5</option><option>4</option><option>3</option></select></label>
          <label>Initiative <select defaultValue="4"><option>5</option><option>4</option><option>3</option></select></label>
          <label>Punctuality <select defaultValue="5"><option>5</option><option>4</option><option>3</option></select></label>
          <label>Work quality <select defaultValue="5"><option>5</option><option>4</option><option>3</option></select></label>
          <div className="evaluation-total">
            <div><span>Overall score</span><strong>4.6</strong></div>
            <small>Based on 4 criteria</small>
          </div>
        </div>
      ) : (
        <blockquote>&ldquo;Francis is dependable and takes initiative when solving unfamiliar problems.&rdquo;</blockquote>
      )}
      <div className="evaluation-footer">
        <span>Mia Santos · Aug 7</span>
        <span>Formal evaluation</span>
      </div>
    </div>
  );
}

export function EmptyModal({ title, description, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

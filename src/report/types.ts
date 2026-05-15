export type PMReport = {
  date: string;
  summary: {
    total_projects: number;
    healthy: number;
    needs_attention: number;
    blocked: number;
    message: string;
  };
  projects: Array<{
    id: string;
    name: string;
    status: string;
    risk: string;
    progress: string;
    blockers: Array<{
      title: string;
      reason: string;
      needs_alignment_with?: string;
    }>;
    next_actions: Array<{
      title: string;
      priority: number;
      owner: string;
    }>;
    collaborators: Array<{
      id: string;
      role: string;
      needed_for: string[];
    }>;
    task_reframes: Array<{
      original_task: string;
      reason: string;
      split_tasks: Array<{
        title: string;
        owner: string;
        type: string;
      }>;
    }>;
  }>;
  blockers: Array<{
    project_id: string;
    title: string;
    reason: string;
  }>;
  today_focus: Array<{
    priority: number;
    action: string;
    reason: string;
    task_category: string;
    estimated_minutes: number;
  }>;
  collaborator_actions: Array<{
    collaborator: string;
    action: string;
    reason: string;
    message_draft: string;
  }>;
  task_reframes: Array<{
    project_id: string;
    original_task: string;
    split_tasks: Array<{
      title: string;
      owner: string;
      type: string;
      task_category: string;
      estimated_minutes: number;
    }>;
  }>;
  task_time_analysis: {
    total_estimated_minutes: number;
    total_actual_minutes: number;
    variance_minutes: number;
    oversized_tasks: Array<{
      title: string;
      estimated_minutes: number;
      reason: string;
      suggested_split: string[];
    }>;
    categories: Array<{
      category: string;
      estimated_minutes: number;
      actual_minutes: number;
      task_count: number;
      notes: string;
    }>;
    daily_notes: string;
  };
  share_message: string;
  suggested_updates: Array<{
    file: string;
    type: string;
    suggestion: string;
    reason: string;
  }>;
};

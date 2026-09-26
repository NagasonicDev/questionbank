import type { CourseNode } from "../api/types";

/**
 * Turn literal hierarchy picks into classification IDs for filtering.
 * A selected node with no explicitly selected descendant includes its whole
 * branch. If a descendant is selected, keep the parent's own ID and include
 * only explicitly selected descendant branches.
 */
export function effectiveNodeFilterIds(nodes: CourseNode[], selectedIds: Iterable<string>): string[] {
  const selected = new Set(selectedIds);
  const effective = new Set<string>();

  function addSubtree(node: CourseNode) {
    effective.add(node.node_id);
    node.children.forEach(addSubtree);
  }

  function hasSelectedDescendant(node: CourseNode): boolean {
    return node.children.some((child) => selected.has(child.node_id) || hasSelectedDescendant(child));
  }

  function visit(node: CourseNode) {
    if (selected.has(node.node_id)) {
      effective.add(node.node_id);
      if (!hasSelectedDescendant(node)) node.children.forEach(addSubtree);
    }
    node.children.forEach(visit);
  }

  nodes.forEach(visit);
  return Array.from(effective);
}

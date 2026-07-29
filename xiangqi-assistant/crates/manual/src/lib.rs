use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use xiangqi_core::Move;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoveNode {
    pub id: Uuid,
    pub parent_id: Uuid,
    pub mv: Move,
    pub comment: String,
    pub is_mainline: bool,
    pub deleted: bool,
    pub order_key: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualTree {
    root_id: Uuid,
    nodes: HashMap<Uuid, MoveNode>,
    next_order: u64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ManualError {
    #[error("node not found")]
    NodeNotFound,
    #[error("node is not a child of the selected parent")]
    NotAChild,
    #[error("branch order must contain every live child exactly once")]
    InvalidOrder,
}

impl Default for ManualTree {
    fn default() -> Self {
        Self::new()
    }
}

impl ManualTree {
    pub fn new() -> Self {
        Self {
            root_id: Uuid::new_v4(),
            nodes: HashMap::new(),
            next_order: 0,
        }
    }
    pub fn with_root(root_id: Uuid) -> Self {
        Self {
            root_id,
            nodes: HashMap::new(),
            next_order: 0,
        }
    }
    pub fn root_id(&self) -> Uuid {
        self.root_id
    }

    pub fn restore_node(&mut self, node: MoveNode) -> Result<(), ManualError> {
        if node.parent_id != self.root_id && !self.nodes.contains_key(&node.parent_id) {
            return Err(ManualError::NodeNotFound);
        }
        self.next_order = self.next_order.max(node.order_key + 1);
        self.nodes.insert(node.id, node);
        Ok(())
    }

    pub fn restore_nodes(
        &mut self,
        nodes: impl IntoIterator<Item = MoveNode>,
    ) -> Result<(), ManualError> {
        let mut pending: Vec<_> = nodes.into_iter().collect();
        while !pending.is_empty() {
            let before = pending.len();
            let mut deferred = Vec::new();
            for node in pending {
                if node.parent_id == self.root_id || self.nodes.contains_key(&node.parent_id) {
                    self.restore_node(node)?;
                } else {
                    deferred.push(node);
                }
            }
            if deferred.len() == before {
                return Err(ManualError::NodeNotFound);
            }
            pending = deferred;
        }
        Ok(())
    }

    pub fn add_move(
        &mut self,
        parent_id: Uuid,
        mv: Move,
        comment: impl Into<String>,
    ) -> Result<Uuid, ManualError> {
        self.ensure_parent(parent_id)?;
        if let Some(existing) = self
            .nodes
            .values()
            .find(|node| !node.deleted && node.parent_id == parent_id && node.mv == mv)
        {
            return Ok(existing.id);
        }
        let is_mainline = !self
            .nodes
            .values()
            .any(|node| !node.deleted && node.parent_id == parent_id && node.is_mainline);
        let id = Uuid::new_v4();
        let node = MoveNode {
            id,
            parent_id,
            mv,
            comment: comment.into(),
            is_mainline,
            deleted: false,
            order_key: self.next_order,
        };
        self.next_order += 1;
        self.nodes.insert(id, node);
        Ok(id)
    }

    pub fn node(&self, node_id: Uuid) -> Result<&MoveNode, ManualError> {
        self.nodes.get(&node_id).ok_or(ManualError::NodeNotFound)
    }

    pub fn branches(&self, parent_id: Uuid) -> Result<Vec<&MoveNode>, ManualError> {
        self.ensure_parent(parent_id)?;
        let mut result: Vec<_> = self
            .nodes
            .values()
            .filter(|node| node.parent_id == parent_id && !node.deleted)
            .collect();
        result.sort_by_key(|node| node.order_key);
        Ok(result)
    }

    pub fn set_mainline(&mut self, parent_id: Uuid, node_id: Uuid) -> Result<(), ManualError> {
        self.ensure_parent(parent_id)?;
        if !self
            .nodes
            .get(&node_id)
            .is_some_and(|node| node.parent_id == parent_id && !node.deleted)
        {
            return Err(ManualError::NotAChild);
        }
        for node in self
            .nodes
            .values_mut()
            .filter(|node| node.parent_id == parent_id && !node.deleted)
        {
            node.is_mainline = node.id == node_id;
        }
        Ok(())
    }

    pub fn reorder_branches(
        &mut self,
        parent_id: Uuid,
        ordered_ids: &[Uuid],
    ) -> Result<(), ManualError> {
        self.ensure_parent(parent_id)?;
        let mut siblings: Vec<_> = self
            .nodes
            .values()
            .filter(|node| node.parent_id == parent_id && !node.deleted)
            .map(|node| (node.id, node.order_key))
            .collect();
        let mut expected: Vec<_> = siblings.iter().map(|(id, _)| *id).collect();
        let mut requested = ordered_ids.to_vec();
        expected.sort_unstable();
        requested.sort_unstable();
        if requested != expected {
            return Err(ManualError::InvalidOrder);
        }

        siblings.sort_by_key(|(_, order_key)| *order_key);
        let order_keys: Vec<_> = siblings
            .into_iter()
            .map(|(_, order_key)| order_key)
            .collect();
        for (node_id, order_key) in ordered_ids.iter().zip(order_keys) {
            self.nodes
                .get_mut(node_id)
                .ok_or(ManualError::InvalidOrder)?
                .order_key = order_key;
        }
        Ok(())
    }

    pub fn update_comment(
        &mut self,
        node_id: Uuid,
        comment: impl Into<String>,
    ) -> Result<(), ManualError> {
        let node = self
            .nodes
            .get_mut(&node_id)
            .ok_or(ManualError::NodeNotFound)?;
        node.comment = comment.into();
        Ok(())
    }

    pub fn remove(&mut self, node_id: Uuid) -> Result<(), ManualError> {
        let node = self.nodes.get(&node_id).ok_or(ManualError::NodeNotFound)?;
        let (parent_id, was_mainline) = (node.parent_id, node.is_mainline);
        let mut pending = vec![node_id];
        while let Some(current) = pending.pop() {
            pending.extend(
                self.nodes
                    .values()
                    .filter(|node| node.parent_id == current && !node.deleted)
                    .map(|node| node.id),
            );
            if let Some(node) = self.nodes.get_mut(&current) {
                node.deleted = true;
            }
        }
        if was_mainline {
            let next = self
                .nodes
                .values()
                .filter(|node| node.parent_id == parent_id && !node.deleted)
                .min_by_key(|node| node.order_key)
                .map(|node| node.id);
            if let Some(next) = next {
                if let Some(node) = self.nodes.get_mut(&next) {
                    node.is_mainline = true;
                }
            }
        }
        Ok(())
    }

    pub fn line_to(&self, node_id: Uuid) -> Result<Vec<Move>, ManualError> {
        let mut current = self.nodes.get(&node_id).ok_or(ManualError::NodeNotFound)?;
        let mut result = vec![current.mv];
        while current.parent_id != self.root_id {
            current = self
                .nodes
                .get(&current.parent_id)
                .ok_or(ManualError::NodeNotFound)?;
            result.push(current.mv);
        }
        result.reverse();
        Ok(result)
    }

    pub fn active_line(&self, node_id: Uuid) -> Result<Vec<&MoveNode>, ManualError> {
        let mut current = self.nodes.get(&node_id).ok_or(ManualError::NodeNotFound)?;
        let mut result = vec![current];
        while current.parent_id != self.root_id {
            current = self
                .nodes
                .get(&current.parent_id)
                .ok_or(ManualError::NodeNotFound)?;
            result.push(current);
        }
        result.reverse();
        Ok(result)
    }

    fn ensure_parent(&self, parent_id: Uuid) -> Result<(), ManualError> {
        if parent_id == self.root_id || self.nodes.get(&parent_id).is_some_and(|node| !node.deleted)
        {
            Ok(())
        } else {
            Err(ManualError::NodeNotFound)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sibling_moves_are_preserved_as_variations() {
        let mut tree = ManualTree::new();
        let root = tree.root_id();
        let first = tree
            .add_move(root, Move::from_iccs("a0a1").unwrap(), "main")
            .unwrap();
        let second = tree
            .add_move(root, Move::from_iccs("b0c2").unwrap(), "variation")
            .unwrap();
        assert_eq!(tree.branches(root).unwrap().len(), 2);
        assert!(
            tree.branches(root)
                .unwrap()
                .iter()
                .find(|n| n.id == first)
                .unwrap()
                .is_mainline
        );

        tree.set_mainline(root, second).unwrap();
        assert!(
            tree.branches(root)
                .unwrap()
                .iter()
                .find(|n| n.id == second)
                .unwrap()
                .is_mainline
        );
        assert!(
            !tree
                .branches(root)
                .unwrap()
                .iter()
                .find(|n| n.id == first)
                .unwrap()
                .is_mainline
        );
    }

    #[test]
    fn remove_uses_a_tombstone() {
        let mut tree = ManualTree::new();
        let root = tree.root_id();
        let node = tree
            .add_move(root, Move::from_iccs("a0a1").unwrap(), "")
            .unwrap();
        tree.remove(node).unwrap();
        assert!(tree.branches(root).unwrap().is_empty());
        assert!(tree.node(node).unwrap().deleted);
    }

    #[test]
    fn reorders_all_live_siblings_without_changing_the_mainline() {
        let mut tree = ManualTree::new();
        let root = tree.root_id();
        let first = tree
            .add_move(root, Move::from_iccs("a0a1").unwrap(), "")
            .unwrap();
        let second = tree
            .add_move(root, Move::from_iccs("b0c2").unwrap(), "")
            .unwrap();
        let third = tree
            .add_move(root, Move::from_iccs("c0e2").unwrap(), "")
            .unwrap();

        tree.reorder_branches(root, &[third, first, second])
            .unwrap();

        assert_eq!(
            tree.branches(root)
                .unwrap()
                .into_iter()
                .map(|node| node.id)
                .collect::<Vec<_>>(),
            vec![third, first, second]
        );
        assert!(tree.node(first).unwrap().is_mainline);
    }

    #[test]
    fn reorder_rejects_partial_or_foreign_sibling_lists() {
        let mut tree = ManualTree::new();
        let root = tree.root_id();
        let first = tree
            .add_move(root, Move::from_iccs("a0a1").unwrap(), "")
            .unwrap();
        let second = tree
            .add_move(root, Move::from_iccs("b0c2").unwrap(), "")
            .unwrap();

        assert_eq!(
            tree.reorder_branches(root, &[first]),
            Err(ManualError::InvalidOrder)
        );
        assert_eq!(
            tree.reorder_branches(root, &[first, Uuid::new_v4()]),
            Err(ManualError::InvalidOrder)
        );
        assert_eq!(tree.branches(root).unwrap().len(), 2);
        assert_eq!(tree.node(second).unwrap().order_key, 1);
    }

    #[test]
    fn reordered_tree_restores_when_a_child_sorts_before_its_parent() {
        let mut tree = ManualTree::new();
        let root = tree.root_id();
        let first = tree
            .add_move(root, Move::from_iccs("h2e2").unwrap(), "")
            .unwrap();
        tree.add_move(first, Move::from_iccs("h9g7").unwrap(), "")
            .unwrap();
        let second = tree
            .add_move(root, Move::from_iccs("b2e2").unwrap(), "")
            .unwrap();
        tree.reorder_branches(root, &[second, first]).unwrap();
        let mut nodes: Vec<_> = tree.nodes.values().cloned().collect();
        nodes.sort_by_key(|node| node.order_key);

        let mut restored = ManualTree::with_root(root);
        restored.restore_nodes(nodes).unwrap();

        assert_eq!(
            restored
                .branches(root)
                .unwrap()
                .into_iter()
                .map(|node| node.id)
                .collect::<Vec<_>>(),
            vec![second, first]
        );
        assert_eq!(restored.branches(first).unwrap().len(), 1);
    }

    #[test]
    fn removing_a_branch_tombstones_its_descendants() {
        let mut tree = ManualTree::new();
        let parent = tree
            .add_move(tree.root_id(), Move::from_iccs("a0a1").unwrap(), "")
            .unwrap();
        let child = tree
            .add_move(parent, Move::from_iccs("a9a8").unwrap(), "")
            .unwrap();
        tree.remove(parent).unwrap();
        assert!(tree.node(parent).unwrap().deleted);
        assert!(tree.node(child).unwrap().deleted);
    }

    #[test]
    fn line_to_returns_moves_from_root() {
        let mut tree = ManualTree::new();
        let first = tree
            .add_move(tree.root_id(), Move::from_iccs("a0a1").unwrap(), "")
            .unwrap();
        let second = tree
            .add_move(first, Move::from_iccs("a9a8").unwrap(), "")
            .unwrap();
        assert_eq!(
            tree.line_to(second)
                .unwrap()
                .iter()
                .map(|mv| mv.to_iccs())
                .collect::<Vec<_>>(),
            ["a0a1", "a9a8"]
        );
    }
}

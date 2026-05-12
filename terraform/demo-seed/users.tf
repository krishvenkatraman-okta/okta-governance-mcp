resource "okta_user" "seeded" {
  for_each = local.users

  first_name = each.key
  last_name  = each.value.dept
  login      = "${local.prefix}-${replace(each.key, "_", "-")}@${var.user_email_domain}"
  email      = "${local.prefix}-${replace(each.key, "_", "-")}@${var.user_email_domain}"

  status     = "STAGED"
  department = each.value.dept
  title = (
    each.value.role == "mgr"
    ? local.departments[each.value.dept].title_mgr
    : local.departments[each.value.dept].title_ic
  )

  # Free-text manager display only. manager_id is intentionally NOT set —
  # `for_each` resources can't cross-reference their own keys without a graph
  # cycle, even when the data forms a DAG. Default peer strategy
  # (department_title) doesn't need manager_id; the optional `manager`
  # strategy is unavailable until set via a post-apply API patch.
  manager = each.value.manager_key
}

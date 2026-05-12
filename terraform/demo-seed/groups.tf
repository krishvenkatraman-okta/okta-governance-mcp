resource "okta_group" "seeded" {
  for_each = local.groups

  name        = "${local.prefix}-${replace(each.key, "_", "-")}"
  description = each.value.description
}

resource "okta_group_memberships" "seeded" {
  for_each = local.group_members

  group_id = okta_group.seeded[each.key].id
  users    = [for user_key in each.value : okta_user.seeded[user_key].id]
}

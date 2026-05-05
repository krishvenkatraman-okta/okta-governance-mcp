resource "okta_entitlement" "seeded" {
  for_each = var.skip_entitlements ? {} : local.entitlements

  name           = each.value.name
  external_value = each.value.external_value
  description    = each.value.description
  multi_value    = each.value.multi_value
  data_type      = each.value.multi_value ? "array" : "string"

  parent {
    external_id = okta_app_oauth.seeded["acme"].id
    type        = "APPLICATION"
  }

  dynamic "values" {
    for_each = each.value.values
    iterator = v
    content {
      name           = v.value.name
      external_value = v.key
      description    = v.value.description
    }
  }
}

resource "okta_entitlement_bundle" "seeded" {
  for_each = var.skip_entitlements ? {} : local.bundles

  name        = "${local.prefix}-${each.key}"
  description = each.value.description

  target {
    external_id = okta_app_oauth.seeded["acme"].id
    type        = "APPLICATION"
  }

  dynamic "entitlements" {
    for_each = each.value.contents
    iterator = ent
    content {
      id = okta_entitlement.seeded[ent.key].id

      dynamic "values" {
        for_each = ent.value
        iterator = vk
        content {
          id = [
            for v in okta_entitlement.seeded[ent.key].values :
            v.id if v.external_value == vk.value
          ][0]
        }
      }
    }
  }
}
